import type { DeviceEvent } from "@matecrew/device-ui/link";

export type LogLevel = "E" | "W" | "I" | "D" | "V";

/**
 * One line of a terminal's log as the console shows it: what the firmware logged (over
 * Bluetooth), or what the console sent and noticed (commands, link, screen).
 */
export type LogEntry = {
  id: string;
  /** Epoch milliseconds. */
  at: number;
  source: "device" | "console";
  level: LogLevel;
  /** The firmware module ("api", "ble"), or the console's kind ("input", "link", "screen"). */
  tag: string;
  text: string;
  /** For a command: whether the terminal picked it up. */
  status?: "waiting" | "delivered" | "dropped";
};

/** The console's own kinds of line. */
export type ConsoleKind = "input" | "system" | "screen" | "link" | "error";

/** Free memory as the firmware logs it after each drawing (`heap:` in `device/firmware/src/main.rs`). */
export type MemorySample = {
  at: number;
  /** Internal RAM free, bytes: task stacks, DMA, Wi-Fi timers. */
  internal: number;
  /** Largest contiguous internal block, bytes. */
  largest: number;
  /** PSRAM free, bytes: scenes, JSON, the frame. */
  psram: number;
  /** The render task's lowest stack headroom since boot, bytes. */
  stackMin: number;
};

const HEAP = /^heap: internal=(\d+) largest=(\d+) psram=(\d+) stack_min=(\d+)/;

/** A `heap:` log line as a sample, or null for any other line. */
export function parseHeap(message: string, at: number): MemorySample | null {
  const match = HEAP.exec(message);
  if (!match) return null;
  const [internal, largest, psram, stackMin] = match.slice(1).map(Number);
  return { at, internal, largest, psram, stackMin };
}

/** "matecrew_device::api" → "api"; the firmware's main module → "main". */
export function shortTag(target: string): string {
  const last = target.split("::").pop() ?? target;
  return last === "matecrew_device" ? "main" : last;
}

/** A Bluetooth event as a log line; null for update progress, which the update shows itself. */
export function deviceLogEntry(event: DeviceEvent, id: string, at: number): LogEntry | null {
  if (event.t === "log") return { id, at, source: "device", level: event.level, tag: shortTag(event.target), text: event.msg };
  if (event.t === "done" && !event.ok && event.error)
    return { id, at, source: "device", level: "E", tag: event.op, text: event.error };
  return null;
}

/** The log as text, oldest first, for a copy or a download. */
export function logText(entries: readonly LogEntry[], time: (at: number) => string): string {
  return entries
    .map((entry) => {
      const status = entry.status ? ` [${entry.status}]` : "";
      const tag = entry.source === "device" ? entry.tag : "console/" + entry.tag;
      return `${time(entry.at)} ${entry.level} ${tag}: ${entry.text}${status}`;
    })
    .join("\n");
}
