import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSOLE_HEADER,
  FRAME_BYTES,
  PANEL_HEIGHT,
  ROW_BYTES,
  TERMINAL_HEADER,
  applyPatch,
  changedRows,
  command,
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

test("only the rows that changed travel, and they rebuild the screen", () => {
  const before = new Uint8Array(FRAME_BYTES);
  const after = before.slice();
  assert.equal(changedRows(before, after), null);
  assert.deepEqual(changedRows(null, after)?.rows, PANEL_HEIGHT);
  after[40 * ROW_BYTES + 7] = 0xf0;
  after[42 * ROW_BYTES + 99] = 0x0f;
  const patch = changedRows(before, after);
  assert.ok(patch);
  assert.equal(patch.y, 40);
  assert.equal(patch.rows, 3);

  const sent = writePatch(patch);
  assert.equal(sent.byteLength, TERMINAL_HEADER + 3 * ROW_BYTES);
  const received = readPatch(sent, TERMINAL_HEADER);
  assert.ok(received);
  assert.equal(received.drawnAt, null);

  const relayed = writePatch(received, 1_760_000_000_123);
  const shown = readPatch(relayed.buffer, CONSOLE_HEADER);
  assert.ok(shown);
  assert.equal(shown.drawnAt, 1_760_000_000_123);
  const rebuilt = before.slice();
  applyPatch(rebuilt, shown);
  assert.deepEqual(rebuilt, after);
});

test("a patch that does not fit the panel is refused", () => {
  const tooLow = new Uint8Array(TERMINAL_HEADER + ROW_BYTES);
  new DataView(tooLow.buffer).setUint16(0, PANEL_HEIGHT, true);
  new DataView(tooLow.buffer).setUint16(2, 1, true);
  assert.equal(readPatch(tooLow, TERMINAL_HEADER), null);
  const short = new Uint8Array(TERMINAL_HEADER + 10);
  new DataView(short.buffer).setUint16(2, 1, true);
  assert.equal(readPatch(short, TERMINAL_HEADER), null);
  assert.equal(readPatch(new Uint8Array(2), TERMINAL_HEADER), null);
});
