/**
 * What goes through a terminal's relay. Text frames are JSON with a `t` tag; the terminal's
 * screen goes as a binary frame (800 x 480, packed 1-bit, 48 000 bytes) both ways.
 *
 *   terminal → relay   hello, status, log, ack            (+ binary screen)
 *   relay → terminal   command, live
 *   console → relay    command
 *   relay → console    online, status, log, commandStatus (+ binary screen)
 *   site → relay       POST /terminals/:id/commands {command}
 */

/** A console command, as the site's device API sends it (`src/lib/device/contract.ts`). */
export type Command = { id: string; kind: string; [field: string]: unknown };

export type FromTerminal =
  | { t: "hello"; firmware?: string; batteryMv?: number | null; rssi?: number | null }
  | { t: "status"; [field: string]: unknown }
  | { t: "log"; line: string }
  | { t: "ack"; id: string };

export type ToTerminal = { t: "command"; command: Command } | { t: "live"; watching: boolean };

export type FromConsole = { t: "command"; command: Command };

export type CommandStatus = "sent" | "waiting" | "delivered" | "dropped";

export type ToConsole =
  | { t: "online"; online: boolean; since: number | null }
  | { t: "status"; status: Record<string, unknown> }
  | { t: "log"; line: string; at: number }
  | { t: "commandStatus"; id: string; status: CommandStatus };

/** Bytes of a screen frame. */
export const FRAME_BYTES = (800 * 480) / 8;
/** How long a command waits for a terminal that is not connected. */
export const COMMAND_TTL_MS = 60_000;

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
  if (typeof id !== "string" || id.length === 0 || id.length > 64 || typeof kind !== "string") return null;
  return JSON.stringify(value).length <= 1024 ? (value as Command) : null;
}
