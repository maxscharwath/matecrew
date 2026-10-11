/**
 * A terminal's live channel, through its relay (one Durable Object per terminal, `./terminal.ts`).
 * The terminal keeps one WebSocket open; the site's consoles open theirs; nothing polls.
 *
 *   terminal → relay   hello, status, ack, log, beep  + binary screen patch (`writePatch`)
 *   relay → terminal   command, live, sync
 *   console → relay    command, watch
 *   relay → console    online, status, log, beep, commands, command  + binary screen patch, with `drawnAt`
 *   site → relay       RPC on the Durable Object (`Terminal` in ./terminal.ts)
 *
 * Text frames are JSON with a `t` tag. Every socket asks for the `SUBPROTOCOL`; browsers cannot set
 * headers on a WebSocket, so their credential travels as a second subprotocol (`mcd_…` for a
 * terminal's token, `mct_…` for a console's one-time ticket). The ESP32 sends its token in
 * `Authorization` instead.
 *
 * This module runs in the relay, in the site (server and browser) and in tests: no runtime APIs
 * beyond the language.
 */

/** The subprotocol every socket asks for, and the relay answers with. */
export const SUBPROTOCOL = "matecrew";

/**
 * The terminal's heartbeat: it sends PING every PING_EVERY_MS and the relay answers PONG by itself
 * (`setWebSocketAutoResponse`), without waking the Durable Object. It keeps NAT mappings open and
 * tells both ends the other is still there.
 */
export const PING = "p";
export const PONG = "o";
export const PING_EVERY_MS = 30_000;
/** Past PING_EVERY_MS plus this without a ping, the terminal is gone (power cut, Wi-Fi lost). */
export const PING_GRACE_MS = 15_000;

/** A key, badge or tap still undelivered after this is dropped: pressing it later would surprise. */
export const INPUT_TTL_MS = 60_000;
/** Other commands (sync, restart, app) wait this long for the terminal to connect. */
export const COMMAND_TTL_MS = 24 * 3_600_000;
/** Commands each console gets when it opens. */
export const HISTORY = 20;

export const PANEL_WIDTH = 800;
export const PANEL_HEIGHT = 480;
/** One row of the panel, packed 1 bit per pixel, MSB first, 1 = ink. */
export const ROW_BYTES = PANEL_WIDTH / 8;
export const FRAME_BYTES = ROW_BYTES * PANEL_HEIGHT;

/** A console command, as the terminal runs it (`DeviceCommand` in src/lib/device/contract.ts). */
export type Command = { id: string; kind: string; [field: string]: unknown };

export type CommandStatus = "sent" | "waiting" | "delivered" | "dropped";

/** A command as consoles list it: who sent it (a user id, null for the site itself) and where it stands. */
export type CommandEntry = { id: string; command: Command; at: number; by: string | null; status: CommandStatus };

/** What the terminal says about itself; every field optional, unknown ones kept as they come. */
export type TerminalStatus = {
  firmware?: string;
  batteryMv?: number | null;
  rssi?: number | null;
  /** The app it runs: "mate", "showcase", a downloaded one. */
  app?: string | null;
  /** Free internal heap, in bytes. */
  heap?: number | null;
  /** Seconds since it started. */
  uptime?: number | null;
  /** When it last synced with the site (ms since 1970, its clock). */
  syncedAt?: number | null;
  [field: string]: unknown;
};

/** A log line's level, as the firmware's logger names them. */
export type LogLevel = "E" | "W" | "I" | "D" | "V";

/**
 * The log and the beeps have the shape they have over Bluetooth (`DeviceEvent` in
 * device/sdk/link, `link::Event` in device/core): one per transport would only differ.
 */
export type FromTerminal =
  | { t: "hello"; status: TerminalStatus }
  | { t: "status"; status: TerminalStatus }
  | { t: "ack"; id: string }
  | { t: "log"; level: LogLevel; target: string; msg: string }
  /** The piezo plays these tones, [Hz, ms] (0 Hz is a silence): consoles play them too. */
  | { t: "beep"; tones: Tone[] };

/** One tone of a beep: [Hz, ms], 0 Hz a silence. */
export type Tone = [hz: number, ms: number];

export type ToTerminal =
  | { t: "command"; command: Command }
  /** Whether a console wants its screen: it sends patches only then. */
  | { t: "live"; watching: boolean }
  /** What it shows changed on the site at `at` (ms since 1970): sync, unless it synced since. */
  | { t: "sync"; at: number };

export type FromConsole =
  | { t: "command"; command: Command }
  /** `screen: false` while the console has the screen another way (Bluetooth). */
  | { t: "watch"; screen: boolean };

export type ToConsole =
  | { t: "online"; online: boolean; since: number | null }
  | { t: "status"; status: TerminalStatus; at: number }
  | { t: "log"; level: LogLevel; target: string; msg: string; at: number }
  | { t: "beep"; tones: Tone[]; at: number }
  | { t: "commands"; entries: CommandEntry[] }
  | { t: "command"; entry: CommandEntry };

/** What the site asks a terminal's relay for (`Terminal.presence`). */
export type Presence = {
  online: boolean;
  /** Since when it is connected (ms since 1970), null when offline. */
  since: number | null;
  status: TerminalStatus | null;
  statusAt: number | null;
  /** When its last screen arrived, null without one. */
  drawnAt: number | null;
};

/** A text frame as one of `kinds`, or null for anything else. */
export function parse<T extends { t: string }>(text: string, kinds: readonly T["t"][]): T | null {
  try {
    const message = JSON.parse(text) as { t?: unknown };
    return typeof message?.t === "string" && (kinds as readonly string[]).includes(message.t) ? (message as T) : null;
  } catch {
    return null;
  }
}

/** A command from a console or the site: an id and a kind, at most 1 KB. */
export function command(value: unknown): Command | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, kind } = value as { id?: unknown; kind?: unknown };
  if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id) || typeof kind !== "string") return null;
  return JSON.stringify(value).length <= 1024 ? (value as Command) : null;
}

/** A beep's tones as the terminal sent them, or null: at most 32 tones, audible, under 2 s each. */
export function tones(value: unknown): Tone[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return null;
  const valid = value.every(
    (tone) =>
      Array.isArray(tone) &&
      tone.length === 2 &&
      Number.isInteger(tone[0]) &&
      tone[0] >= 0 &&
      tone[0] <= 20_000 &&
      Number.isInteger(tone[1]) &&
      tone[1] > 0 &&
      tone[1] <= 2_000,
  );
  return valid ? (value as Tone[]) : null;
}

/** Keys, badges and taps: worth running only right away. */
export function isInput(command: Command): boolean {
  return ["key", "both", "badge", "tap"].includes(command.kind);
}

/**
 * The screen goes as the rectangle that changed since the last one the other end has, deflated:
 * measured on the panel's 79 previews, a whole screen is about 3.5 KB (48 000 raw), a new page
 * about 3 KB, a counter a few hundred bytes (`device/core/src/live.rs` writes the same on the
 * ESP32, with its ROM's deflate). Raw deflate (no zlib header): browsers and Workers inflate it
 * natively (`DecompressionStream("deflate-raw")`).
 */
export type Rect = { x: number; y: number; w: number; h: number };

/** The rectangle's bytes as they are. */
export const RAW = 0;
/** The rectangle's bytes deflated. */
export const DEFLATE = 1;
export type Format = typeof RAW | typeof DEFLATE;

/** A rectangle of the panel: `x` and `w` in bytes (8 pixels each), `y` and `h` in rows. */
export type Patch = { rect: Rect; format: Format; data: Uint8Array };

/** Terminal → relay: `[format u8][x u8][w u8][y u16 LE][h u16 LE]`, then the data. */
export const TERMINAL_HEADER = 7;
/** Relay → console: the same, then `drawnAt` (f64 LE, ms since 1970), then the data. */
export const CONSOLE_HEADER = 15;

export const WHOLE: Rect = { x: 0, y: 0, w: ROW_BYTES, h: PANEL_HEIGHT };

/** The patch in a binary frame with a `header`-byte header, or null when it does not fit the panel. */
export function readPatch(data: ArrayBuffer | Uint8Array, header: number): (Patch & { drawnAt: number | null }) | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < header) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = bytes[0];
  const rect = { x: bytes[1], w: bytes[2], y: view.getUint16(3, true), h: view.getUint16(5, true) };
  const fits = rect.w > 0 && rect.h > 0 && rect.x + rect.w <= ROW_BYTES && rect.y + rect.h <= PANEL_HEIGHT;
  const data_ = bytes.subarray(header);
  const sized = format === DEFLATE || data_.byteLength === rect.w * rect.h;
  if ((format !== RAW && format !== DEFLATE) || !fits || !sized) return null;
  const drawnAt = header >= CONSOLE_HEADER ? view.getFloat64(7, true) : null;
  return { rect, format, data: data_, drawnAt };
}

/** The binary frame of `patch`: for the relay with no `drawnAt`, for a console with one. */
export function writePatch(patch: Patch, drawnAt?: number): Uint8Array<ArrayBuffer> {
  const header = drawnAt === undefined ? TERMINAL_HEADER : CONSOLE_HEADER;
  const out = new Uint8Array(header + patch.data.byteLength);
  const view = new DataView(out.buffer);
  out.set([patch.format, patch.rect.x, patch.rect.w]);
  view.setUint16(3, patch.rect.y, true);
  view.setUint16(5, patch.rect.h, true);
  if (drawnAt !== undefined) view.setFloat64(7, drawnAt, true);
  out.set(patch.data, header);
  return out;
}

/** The smallest rectangle holding every byte that differs; the whole panel without `before`, null when none does. */
export function changedRect(before: Uint8Array | null, after: Uint8Array): Rect | null {
  if (before?.length !== FRAME_BYTES || after.length !== FRAME_BYTES) return WHOLE;
  let x0 = ROW_BYTES, x1 = -1, y0 = PANEL_HEIGHT, y1 = -1;
  for (let y = 0; y < PANEL_HEIGHT; y++) {
    const row = y * ROW_BYTES;
    let first = -1, last = -1;
    for (let x = 0; x < ROW_BYTES; x++) {
      if (before[row + x] === after[row + x]) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first < 0) continue;
    x0 = Math.min(x0, first);
    x1 = Math.max(x1, last);
    y0 = Math.min(y0, y);
    y1 = y;
  }
  return y1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The bytes of `frame` inside `rect`, row after row. */
export function rectBytes(frame: Uint8Array, rect: Rect): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(rect.w * rect.h);
  for (let r = 0; r < rect.h; r++) {
    const from = (rect.y + r) * ROW_BYTES + rect.x;
    out.set(frame.subarray(from, from + rect.w), r * rect.w);
  }
  return out;
}

/** Writes a rectangle's bytes into a whole frame. */
export function applyRect(frame: Uint8Array, rect: Rect, bytes: Uint8Array): void {
  for (let r = 0; r < rect.h; r++) frame.set(bytes.subarray(r * rect.w, (r + 1) * rect.w), (rect.y + r) * ROW_BYTES + rect.x);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array | null> {
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    // A deflated rectangle never inflates past the panel: anything more is not one.
    if (length > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** `rect` of `frame` as a patch: deflated, unless that is not smaller. */
export async function encodeRect(frame: Uint8Array, rect: Rect): Promise<Patch> {
  const raw = rectBytes(frame, rect);
  const deflated = await pipe(raw, new CompressionStream("deflate-raw"), Number.POSITIVE_INFINITY);
  return deflated && deflated.byteLength < raw.byteLength
    ? { rect, format: DEFLATE, data: deflated }
    : { rect, format: RAW, data: raw };
}

/** The rectangle's bytes, inflated when they were deflated; null when they do not make the rectangle. */
export async function decodeRect(patch: Patch): Promise<Uint8Array | null> {
  const size = patch.rect.w * patch.rect.h;
  const bytes = patch.format === DEFLATE ? await pipe(patch.data, new DecompressionStream("deflate-raw"), size).catch(() => null) : patch.data;
  return bytes?.byteLength === size ? bytes : null;
}
