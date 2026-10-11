import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSOLE_HEADER,
  DEFLATE,
  FRAME_BYTES,
  PANEL_HEIGHT,
  RAW,
  ROW_BYTES,
  TERMINAL_HEADER,
  WHOLE,
  applyRect,
  changedRect,
  command,
  decodeRect,
  encodeRect,
  isInput,
  parse,
  readPatch,
  writePatch,
  type FromTerminal,
} from "../src/protocol";

test("frames parse by kind, and commands need an id and a kind", () => {
  assert.deepEqual(parse<FromTerminal>('{"t":"ack","id":"c1"}', ["ack"]), { t: "ack", id: "c1" });
  assert.equal(parse<FromTerminal>('{"t":"other"}', ["ack"]), null);
  assert.equal(parse<FromTerminal>("not json", ["ack"]), null);
  assert.deepEqual(command({ id: "c1", kind: "key", side: "left" }), { id: "c1", kind: "key", side: "left" });
  assert.equal(command({ kind: "key" }), null);
  assert.equal(command({ id: "has spaces", kind: "key" }), null);
  assert.equal(command({ id: "c1", kind: "badge", uid: "x".repeat(2_000) }), null, "too big");
});

test("keys, badges and taps are inputs, worth running only right away", () => {
  assert.equal(isInput({ id: "a", kind: "both" }), true);
  assert.equal(isInput({ id: "a", kind: "tap", x: 1, y: 2 }), true);
  assert.equal(isInput({ id: "a", kind: "restart" }), false);
});

test("only the rectangle that changed travels, deflated, and it rebuilds the screen", async () => {
  const before = new Uint8Array(FRAME_BYTES);
  const after = before.slice();
  assert.equal(changedRect(before, after), null);
  assert.deepEqual(changedRect(null, after), WHOLE);
  after[40 * ROW_BYTES + 7] = 0xf0;
  after[42 * ROW_BYTES + 12] = 0x0f;
  const rect = changedRect(before, after);
  assert.deepEqual(rect, { x: 7, y: 40, w: 6, h: 3 });
  assert.ok(rect);

  const sent = writePatch(await encodeRect(after, rect));
  const received = readPatch(sent, TERMINAL_HEADER);
  assert.ok(received);
  assert.equal(received.drawnAt, null);

  const relayed = writePatch(received, 1_760_000_000_123);
  const shown = readPatch(relayed.buffer, CONSOLE_HEADER);
  assert.ok(shown);
  assert.equal(shown.drawnAt, 1_760_000_000_123);
  const bytes = await decodeRect(shown);
  assert.ok(bytes);
  const rebuilt = before.slice();
  applyRect(rebuilt, shown.rect, bytes);
  assert.deepEqual(rebuilt, after);
});

test("a whole screen deflates, raw stays raw when deflate does not help", async () => {
  const screen = new Uint8Array(FRAME_BYTES);
  for (let y = 0; y < PANEL_HEIGHT; y += 24) screen.fill(0xff, y * ROW_BYTES + 10, y * ROW_BYTES + 90);
  const whole = await encodeRect(screen, WHOLE);
  assert.equal(whole.format, DEFLATE);
  assert.ok(whole.data.byteLength < 1_000, `${whole.data.byteLength} bytes`);
  const noise = new Uint8Array(FRAME_BYTES).map((_, i) => (i * 2_654_435_761) >>> 24);
  const tiny = await encodeRect(noise, { x: 0, y: 0, w: 2, h: 1 });
  assert.equal(tiny.format, RAW);
});

test("a patch that does not fit the panel, or inflates past its rectangle, is refused", async () => {
  const off = writePatch({ rect: { x: 99, y: 0, w: 2, h: 1 }, format: RAW, data: new Uint8Array(2) });
  assert.equal(readPatch(off, TERMINAL_HEADER), null);
  const low = writePatch({ rect: { x: 0, y: 479, w: 1, h: 2 }, format: RAW, data: new Uint8Array(2) });
  assert.equal(readPatch(low, TERMINAL_HEADER), null);
  const short = writePatch({ rect: { x: 0, y: 0, w: 4, h: 4 }, format: RAW, data: new Uint8Array(3) });
  assert.equal(readPatch(short, TERMINAL_HEADER), null);
  assert.equal(readPatch(new Uint8Array(2), TERMINAL_HEADER), null);
  // A bomb: a whole deflated screen sent as a 1-byte rectangle.
  const bomb = await encodeRect(new Uint8Array(FRAME_BYTES), WHOLE);
  assert.equal(await decodeRect({ ...bomb, rect: { x: 0, y: 0, w: 1, h: 1 } }), null);
});
