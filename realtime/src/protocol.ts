/**
 * A terminal's live channel, through its relay (one Durable Object per terminal, `./terminal.ts`).
 * The terminal keeps one WebSocket open; the site's consoles open theirs; nothing polls.
 *
 *   terminal → relay   hello, status, ack, log, beep  + binary screen patch (`TerminalPatch`)
 *   relay → terminal   command, live, sync
 *   console → relay    command, watch
 *   relay → console    online, status, log, beep, commands, command  + binary screen patch (`ConsolePatch`)
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
 * Rows `y` to `y + rows` of the panel. The terminal sends only the rows that changed since the
 * screen it sent before (a clock, a counter: a few KB instead of 48), and the whole panel after
 * connecting or when a console starts watching.
 */
export type Patch = { y: number; rows: number; bits: Uint8Array };

/** Terminal → relay: `[y u16 LE][rows u16 LE][rows × ROW_BYTES]`. */
export const TERMINAL_HEADER = 4;
/** Relay → console: `[y u16 LE][rows u16 LE][drawnAt f64 LE, ms since 1970][rows × ROW_BYTES]`. */
export const CONSOLE_HEADER = 12;

/** The patch in a binary frame with a `header`-byte header, or null when it does not fit the panel. */
export function readPatch(data: ArrayBuffer | Uint8Array, header: number): (Patch & { drawnAt: number | null }) | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < header) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const y = view.getUint16(0, true);
  const rows = view.getUint16(2, true);
  if (rows === 0 || y + rows > PANEL_HEIGHT || bytes.byteLength !== header + rows * ROW_BYTES) return null;
  const drawnAt = header >= CONSOLE_HEADER ? view.getFloat64(4, true) : null;
  return { y, rows, bits: bytes.subarray(header), drawnAt };
}

/** The binary frame of `patch`: for the relay with no `drawnAt`, for a console with one. */
export function writePatch(patch: Patch, drawnAt?: number): Uint8Array<ArrayBuffer> {
  const header = drawnAt === undefined ? TERMINAL_HEADER : CONSOLE_HEADER;
  const out = new Uint8Array(header + patch.rows * ROW_BYTES);
  const view = new DataView(out.buffer);
  view.setUint16(0, patch.y, true);
  view.setUint16(2, patch.rows, true);
  if (drawnAt !== undefined) view.setFloat64(4, drawnAt, true);
  out.set(patch.bits.subarray(0, patch.rows * ROW_BYTES), header);
  return out;
}

/** Writes `patch` into a whole frame. */
export function applyPatch(frame: Uint8Array, patch: Patch): void {
  frame.set(patch.bits.subarray(0, patch.rows * ROW_BYTES), patch.y * ROW_BYTES);
}

/** The rows that differ between two frames, as one patch of `after`; null when they are the same. */
export function changedRows(before: Uint8Array | null, after: Uint8Array): Patch | null {
  if (!before || before.length !== after.length) return { y: 0, rows: PANEL_HEIGHT, bits: after };
  let first = -1;
  let last = -1;
  for (let row = 0; row < PANEL_HEIGHT; row++) {
    const start = row * ROW_BYTES;
    for (let i = start; i < start + ROW_BYTES; i++) {
      if (before[i] !== after[i]) {
        if (first < 0) first = row;
        last = row;
        break;
      }
    }
  }
  if (first < 0) return null;
  const rows = last - first + 1;
  return { y: first, rows, bits: after.subarray(first * ROW_BYTES, (last + 1) * ROW_BYTES) };
}
