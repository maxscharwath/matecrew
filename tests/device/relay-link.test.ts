import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { RelayLink, isNews, retryDelay, screenRect } from "../../src/lib/device/virtual/relay";
import { DEFLATE, FRAME_BYTES, ROW_BYTES, TERMINAL_HEADER, WHOLE, decodeRect, readPatch } from "../../realtime/src/protocol";

/** A WebSocket that records what is sent and lets the test play the relay. */
class FakeSocket {
  static readonly created: FakeSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = "blob";
  sent: (string | Uint8Array)[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.created.push(this);
  }
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  // The relay's side.
  accept() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  say(message: unknown) {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) });
  }
  hangUp() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const realSocket = globalThis.WebSocket;
afterEach(() => {
  globalThis.WebSocket = realSocket;
  FakeSocket.created.length = 0;
});

function link() {
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const seen: string[] = [];
  const relay = new RelayLink("wss://relay.test/terminals/socket", "mcd_testtesttesttesttesttest", {
    opened: () => seen.push("opened"),
    closed: (refused) => seen.push(refused ? "refused" : "closed"),
    command: (command) => seen.push(`command ${command.id}`),
    live: (watching) => seen.push(`live ${watching}`),
    sync: (at) => seen.push(`sync ${at}`),
  });
  relay.start();
  const socket = FakeSocket.created.at(-1);
  assert.ok(socket);
  return { relay, socket, seen };
}

test("a change is news only after the state the terminal has, to the second", () => {
  assert.equal(isNews(1_000, null), true);
  assert.equal(isNews(Date.parse("2026-10-11T10:00:00.900Z"), "2026-10-11T10:00:00.500Z"), true, "fractions dropped, as the firmware reads it");
  assert.equal(isNews(Date.parse("2026-10-11T09:59:59Z"), "2026-10-11T10:00:00Z"), false);
});

test("the whole screen first, then only the rectangle that changed", () => {
  const frame = new Uint8Array(FRAME_BYTES);
  assert.deepEqual(screenRect(null, frame, false), WHOLE);
  assert.deepEqual(screenRect(frame, frame, true), WHOLE);
  assert.equal(screenRect(frame, frame.slice(), false), null);
  const next = frame.slice();
  next[7 * ROW_BYTES + 9] = 1;
  assert.deepEqual(screenRect(frame, next, false), { x: 9, y: 7, w: 1, h: 1 });
});

test("reconnections back off from half a second to ten", () => {
  assert.deepEqual([0, 1, 2, 5, 9].map(retryDelay), [500, 1000, 2000, 10_000, 10_000]);
});

test("the token goes as a subprotocol, commands and changes come through", () => {
  const { relay, socket, seen } = link();
  assert.deepEqual(socket.protocols, ["matecrew", "mcd_testtesttesttesttesttest"]);
  socket.accept();
  assert.equal(relay.open, true);
  socket.say({ t: "command", command: { id: "c1", kind: "key", side: "left" } });
  socket.say({ t: "sync", at: 42 });
  socket.say({ t: "unknown" });
  socket.say("o");
  assert.deepEqual(seen, ["opened", "command c1", "sync 42"]);
  relay.stop();
});

test("the screen goes only while a console watches: whole, then patches, deflated", async () => {
  const { relay, socket } = link();
  socket.accept();
  const frame = new Uint8Array(FRAME_BYTES);
  relay.screen(frame);
  assert.equal(socket.sent.length, 0, "nobody watching");
  socket.say({ t: "live", watching: true });
  relay.screen(frame);
  const next = frame.slice();
  next[300 * ROW_BYTES + 1] = 0xff;
  relay.screen(next);
  relay.screen(next);
  // Deflating awaits; the screens still go in order.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const whole = readPatch(socket.sent[0] as Uint8Array, TERMINAL_HEADER);
  assert.deepEqual(whole?.rect, WHOLE);
  assert.equal(whole?.format, DEFLATE);
  assert.ok((socket.sent[0] as Uint8Array).byteLength < 200, "a blank screen deflates to almost nothing");
  const patch = readPatch(socket.sent[1] as Uint8Array, TERMINAL_HEADER);
  assert.deepEqual(patch?.rect, { x: 1, y: 300, w: 1, h: 1 });
  assert.deepEqual(patch && [...((await decodeRect(patch)) ?? [])], [0xff]);
  assert.equal(socket.sent.length, 2, "nothing changed, nothing sent");
  relay.log("I", "matecrew_web::flow", "test");
  assert.equal(socket.sent[2], '{"t":"log","level":"I","target":"matecrew_web::flow","msg":"test"}');
  socket.say({ t: "live", watching: false });
  relay.log("I", "matecrew_web::flow", "unseen");
  assert.equal(socket.sent.length, 3);
  relay.stop();
});

test("a refusal is said once, then it keeps trying", async () => {
  const { relay, socket, seen } = link();
  socket.hangUp();
  assert.deepEqual(seen, ["refused"]);
  assert.equal(relay.open, false);
  await relay.closed;
  relay.stop();
});
