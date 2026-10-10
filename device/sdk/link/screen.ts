/**
 * The device's screen, mirrored over the link: the updates the device notifies on `SCREEN`, how a
 * browser rebuilds the screen from them, and the requests it writes back. Pure: no Bluetooth, no
 * DOM. Mirrors `screen_update` and `screen_notification` in `device/core/src/link.rs`.
 *
 * A screen is packed rows of `width` pixels, most significant bit first, 1 = ink. An update is a
 * header (kind, width, height, first row, rows, CRC-32 of the updated screen; little-endian) and
 * the changed band of rows, run-length coded. It travels cut into notifications that each start
 * with a sequence number and FIRST/LAST flags, so a lost one shows as a gap.
 */
import { crc32, fail, ok, type Result } from "./protocol";

/** Written to `SCREEN`: send the whole screen next (to start watching, or after a lost notification). */
export const SCREEN_WHOLE = Uint8Array.of(0x01);
/** Flags of a `SCREEN` notification: it starts an update, it ends one. */
export const SCREEN_FIRST = 0x01;
export const SCREEN_LAST = 0x02;
/** Remote taps travel in this grid, whatever the screen's size. */
export const TAP_COLUMNS = 200;
export const TAP_ROWS = 120;

const KEY = 0x01;
const ROWS = 0x02;
const XOR = 0x03;
const HEADER = 13;

/** The device's screen as the mirror rebuilt it. */
export type Screen = {
  width: number;
  height: number;
  /** Packed rows, `ceil(width / 8)` bytes each, MSB first, 1 = ink. A copy per update: keep it. */
  bits: Uint8Array;
  /** The band this update changed: the whole height for the whole screen. */
  changed: { y: number; rows: number };
  /** The update carried the whole screen (the first one, or after a resync). */
  whole: boolean;
};

/** `0x02`, x, y: a touch at (x, y) of the 200 × 120 tap grid. */
export function encodeScreenTap(x: number, y: number): Result<Uint8Array> {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= TAP_COLUMNS || y >= TAP_ROWS) {
    return fail("invalid", `a tap is within ${TAP_COLUMNS} × ${TAP_ROWS}`);
  }
  return ok(Uint8Array.of(0x02, x, y));
}

/**
 * Run-length coding: `0x00..0x7F`, then that many plus one bytes as they are; `0x80..0xFE`, then
 * one byte repeated that many less 0x80 plus 3 times; `0xFF`, one byte and a LEB128 count, the
 * byte repeated 130 times plus the count.
 */
function rle(bytes: Uint8Array, out: number[]): void {
  const literal = (from: number, to: number) => {
    for (let at = from; at < to; at += 128) {
      const n = Math.min(128, to - at);
      out.push(n - 1);
      for (let i = at; i < at + n; i++) out.push(bytes[i]);
    }
  };
  let from = 0;
  let at = 0;
  while (at < bytes.length) {
    const value = bytes[at];
    let run = 1;
    while (at + run < bytes.length && bytes[at + run] === value) run++;
    if (run >= 3) {
      literal(from, at);
      const extra = run - 3;
      if (extra < 0x7f) out.push(0x80 | extra, value);
      else {
        out.push(0xff, value);
        let count = extra - 0x7f;
        while (count >= 0x80) {
          out.push((count & 0x7f) | 0x80);
          count >>>= 7;
        }
        out.push(count);
      }
      from = at + run;
    }
    at += run;
  }
  literal(from, bytes.length);
}

/** The LEB128 count from `from`, and where it ends; null if it is cut short or too long. */
function leb128(data: Uint8Array, from: number): { value: number; end: number } | null {
  let at = from;
  let value = 0;
  for (let shift = 0; shift <= 28; shift += 7) {
    if (at >= data.length) return null;
    const next = data[at++];
    value += (next & 0x7f) * 2 ** shift;
    if (next < 0x80) return { value, end: at };
  }
  return null;
}

/** How many times a repeat run (`head` from 0x80) repeats its byte, and where its count ends; null if cut short. */
function repeatCount(head: number, data: Uint8Array, at: number): { count: number; end: number } | null {
  const count = (head & 0x7f) + 3;
  if (head !== 0xff) return { count, end: at };
  const extra = leb128(data, at);
  return extra ? { count: count + extra.value, end: extra.end } : null;
}

/** Decodes `rle` into exactly `length` bytes; null if the data does not say that. */
function unrle(data: Uint8Array, length: number): Uint8Array | null {
  const out = new Uint8Array(length);
  let at = 0;
  let written = 0;
  while (at < data.length) {
    const head = data[at++];
    if (head < 0x80) {
      const n = head + 1;
      if (at + n > data.length || written + n > length) return null;
      out.set(data.subarray(at, at + n), written);
      at += n;
      written += n;
      continue;
    }
    if (at >= data.length) return null;
    const value = data[at++];
    const repeat = repeatCount(head, data, at);
    if (!repeat || written + repeat.count > length) return null;
    out.fill(value, written, written + repeat.count);
    written += repeat.count;
    at = repeat.end;
  }
  return written === length ? out : null;
}

/**
 * What the device sends when the screen goes from `before` (what the browser has; null for the
 * whole screen) to `after`, or null when no row changed. For emulators and tests: a device written
 * against this module can stream its screen the same way.
 */
export function encodeScreenUpdate(before: Uint8Array | null, after: Uint8Array, width: number, height: number): Uint8Array | null {
  const stride = Math.ceil(width / 8);
  let top = 0;
  let bottom = height;
  if (before) {
    const changed = (y: number) => {
      for (let i = y * stride; i < (y + 1) * stride; i++) if (before[i] !== after[i]) return true;
      return false;
    };
    while (top < height && !changed(top)) top++;
    if (top === height) return null;
    while (!changed(bottom - 1)) bottom--;
  }
  const start = top * stride;
  const end = bottom * stride;
  const header = new Uint8Array(HEADER);
  const view = new DataView(header.buffer);
  header[0] = before ? ROWS : KEY;
  view.setUint16(1, width, true);
  view.setUint16(3, height, true);
  view.setUint16(5, top, true);
  view.setUint16(7, bottom - top, true);
  view.setUint32(9, crc32(after), true);

  const replaced = after.slice(start, end);
  for (let i = Math.max(start, stride); i < end; i++) replaced[i - start] ^= after[i - stride];
  let best: number[] = [...header];
  rle(replaced, best);
  if (before) {
    const xored = after.slice(start, end);
    for (let i = start; i < end; i++) xored[i - start] ^= before[i];
    const candidate: number[] = [XOR, ...header.subarray(1)];
    rle(xored, candidate);
    if (candidate.length < best.length) best = candidate;
  }
  return Uint8Array.from(best);
}

/** `update` cut into `SCREEN` notifications of at most `room` bytes, numbered from `seq`. */
export function screenNotifications(update: Uint8Array, room: number, seq = 0): Uint8Array[] {
  const part = Math.max(1, room - 2);
  const out: Uint8Array[] = [];
  for (let start = 0, index = 0; start < update.length; start += part, index++) {
    const end = Math.min(update.length, start + part);
    const notification = new Uint8Array(2 + end - start);
    notification[0] = (seq + index) & 0xff;
    notification[1] = (start === 0 ? SCREEN_FIRST : 0) | (end === update.length ? SCREEN_LAST : 0);
    notification.set(update.subarray(start, end), 2);
    out.push(notification);
  }
  return out;
}

/** What one notification did: a screen it completed, and whether to ask for the whole screen. */
export type ScreenStep = { screen?: Screen; resync?: boolean };

/**
 * Rebuilds the device's screen from `SCREEN` notifications. Out of step (a gap in the numbers, a
 * CRC that does not match, an update on a screen it does not have), it ignores updates until the
 * whole screen comes, and says when to ask for it (`resync`: write `SCREEN_WHOLE`).
 */
export class ScreenReader {
  private screen: Uint8Array | null = null;
  private width = 0;
  private height = 0;
  private parts: Uint8Array[] = [];
  private expected: number | null = null;
  /** The whole screen was asked for and has not come yet: no need to ask again. */
  private asked: boolean;

  /** `asked`: whoever starts the reader asks for the whole screen itself. */
  constructor({ asked = true }: { asked?: boolean } = {}) {
    this.asked = asked;
  }

  push(notification: Uint8Array): ScreenStep {
    if (notification.length < 2) return {};
    const [seq, flags] = notification;
    // A copy: a transport may reuse the notification's buffer.
    const data = notification.slice(2);
    let lost = false;
    if (this.expected !== null && seq !== this.expected) {
      // Lost on the way: what is being assembled, and the screen, are no longer the device's.
      this.parts = [];
      this.screen = null;
      lost = true;
    }
    this.expected = (seq + 1) & 0xff;
    if (flags & SCREEN_FIRST) {
      // A new update while one was unfinished: the device gave that one up and sends the whole screen.
      if (this.parts.length) this.screen = null;
      this.parts = [data];
    } else if (this.parts.length) {
      this.parts.push(data);
    }
    if (!(flags & SCREEN_LAST) || !this.parts.length) return this.ask(lost);
    const update = concat(this.parts);
    this.parts = [];
    const applied = this.apply(update);
    if (typeof applied === "object") {
      this.asked = false;
      return { screen: applied };
    }
    return this.ask(lost || applied === "broken", true);
  }

  /** A loss or a broken update always asks again; an update before the whole screen asks once. */
  private ask(always: boolean, once = false): ScreenStep {
    if (!always && (!once || this.asked)) return {};
    this.asked = true;
    return { resync: true };
  }

  /** The updated screen; "waiting" for the whole screen; "broken" when the update does not fit. */
  private apply(update: Uint8Array): Screen | "waiting" | "broken" {
    if (update.length < HEADER) return "broken";
    const view = new DataView(update.buffer, update.byteOffset, update.byteLength);
    const kind = update[0];
    const width = view.getUint16(1, true);
    const height = view.getUint16(3, true);
    const top = view.getUint16(5, true);
    const rows = view.getUint16(7, true);
    const crc = view.getUint32(9, true);
    const stride = Math.ceil(width / 8);
    if (kind === KEY) {
      if (top !== 0 || rows !== height) return "broken";
      this.screen = new Uint8Array(stride * height);
      this.width = width;
      this.height = height;
    } else if (kind !== ROWS && kind !== XOR) {
      this.screen = null;
      return "broken";
    }
    const screen = this.screen;
    if (!screen) return "waiting";
    const band = unrle(update.subarray(HEADER), rows * stride);
    if (!band || width !== this.width || height !== this.height || top + rows > height) {
      this.screen = null;
      return "broken";
    }
    writeBand(screen, band, top * stride, stride, kind === XOR);
    if (crc32(screen) !== crc) {
      this.screen = null;
      return "broken";
    }
    return { width, height, bits: screen.slice(), changed: { y: top, rows }, whole: kind === KEY };
  }
}

/** A decoded band into the screen from byte `start`: XORed onto it, or each row XORed with the row above. */
function writeBand(screen: Uint8Array, band: Uint8Array, start: number, stride: number, xor: boolean): void {
  if (xor) {
    for (let i = 0; i < band.length; i++) screen[start + i] ^= band[i];
    return;
  }
  for (let i = 0; i < band.length; i++) {
    const at = start + i;
    screen[at] = band[i] ^ (at >= stride ? screen[at - stride] : 0);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The screen as RGBA pixels, for `new ImageData(rgba, screen.width, screen.height)` and
 * `putImageData`. Ink and paper default to an e-paper's.
 */
export function screenRgba(
  screen: Pick<Screen, "width" | "height" | "bits">,
  ink: readonly [number, number, number] = [0x1d, 0x1d, 0x1f],
  paper: readonly [number, number, number] = [0xf4, 0xf2, 0xec],
): Uint8ClampedArray {
  const { width, height, bits } = screen;
  const stride = Math.ceil(width / 8);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const color = bits[y * stride + (x >> 3)] & (0x80 >> (x & 7)) ? ink : paper;
      const at = (y * width + x) * 4;
      rgba[at] = color[0];
      rgba[at + 1] = color[1];
      rgba[at + 2] = color[2];
      rgba[at + 3] = 255;
    }
  return rgba;
}
