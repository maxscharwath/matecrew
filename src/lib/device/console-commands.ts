import type { RemoteCommand } from "@matecrew/device-ui/link";
import type { DeviceCommand } from "@/lib/device/contract";

/**
 * What an admin does to a terminal from its console, and how it is stored and listed. No server
 * code: the console (a client component) lists commands with it too.
 */
export type ConsoleCommand =
  | { kind: "key"; side: "left" | "right" }
  /** A key held (0.7 s on the terminal): its long press. Stored as a KEY row, arg "long:left". */
  | { kind: "longKey"; side: "left" | "right" }
  /** Both keys together: the terminal's about page. Stored as a KEY row, arg "both". */
  | { kind: "both" }
  | { kind: "badge"; uid: string }
  | { kind: "sync"; app?: "mate" | "showcase" }
  | { kind: "tap"; x: number; y: number }
  | { kind: "restart" }
  | { kind: "forgetWifi" }
  /** Deep sleep now, whatever keeps it awake; a key or its timer wakes it. */
  | { kind: "sleep" };

/** As a `DeviceCommand` row stores it (`prisma/schema.prisma`), and as the console lists it. */
export type CommandRow = {
  kind: "KEY" | "BADGE" | "SYNC" | "RESTART" | "FORGET_WIFI" | "SLEEP";
  arg: string | null;
};

const KIND_TO_ROW = {
  key: "KEY",
  longKey: "KEY",
  both: "KEY",
  badge: "BADGE",
  sync: "SYNC",
  tap: "KEY",
  restart: "RESTART",
  forgetWifi: "FORGET_WIFI",
  sleep: "SLEEP",
} as const;

/** What a row stores besides its kind: the side, the UID, the point or the app. */
function argOf(command: ConsoleCommand): string | null {
  switch (command.kind) {
    case "key":
      return command.side;
    case "longKey":
      return `long:${command.side}`;
    case "both":
      return "both";
    case "badge":
      return command.uid;
    case "tap":
      return `tap:${command.x}:${command.y}`;
    case "sync":
      return command.app ? `app:${command.app}` : null;
    default:
      return null;
  }
}

export function toRow(command: ConsoleCommand): CommandRow {
  return { kind: KIND_TO_ROW[command.kind], arg: argOf(command) };
}

const TAP = /^tap:(\d{1,3}):(\d{1,3})$/;

/** A KEY row's command: a key, a held key, both keys or a tap. */
function keyOf(arg: string | null): ConsoleCommand | null {
  const tap = TAP.exec(arg ?? "");
  if (tap) {
    const [x, y] = [Number(tap[1]), Number(tap[2])];
    return x < 200 && y < 120 ? { kind: "tap", x, y } : null;
  }
  if (arg === "both") return { kind: "both" };
  if (arg === "left" || arg === "right") return { kind: "key", side: arg };
  if (arg === "long:left" || arg === "long:right") return { kind: "longKey", side: arg === "long:left" ? "left" : "right" };
  return null;
}

/** A stored row as the command it was (`toRow` the other way); null for one that makes none. */
export function fromRow(row: CommandRow): ConsoleCommand | null {
  switch (row.kind) {
    case "KEY":
      return keyOf(row.arg);
    case "BADGE":
      return row.arg ? { kind: "badge", uid: row.arg } : null;
    case "SYNC":
      return row.arg === "app:mate" || row.arg === "app:showcase" ? { kind: "sync", app: row.arg === "app:mate" ? "mate" : "showcase" } : { kind: "sync" };
    case "RESTART":
      return { kind: "restart" };
    case "FORGET_WIFI":
      return { kind: "forgetWifi" };
    case "SLEEP":
      return { kind: "sleep" };
  }
}

/** The command as the terminal runs it, with its id. */
export function withId(command: ConsoleCommand, id: string): DeviceCommand {
  return { id, ...command } as DeviceCommand;
}

/** A command the relay lists, as the console's; null for a kind it does not know. */
export function fromWire(command: { kind: string; [field: string]: unknown }): ConsoleCommand | null {
  if (!(command.kind in KIND_TO_ROW)) return null;
  const rest: Record<string, unknown> = { ...command };
  delete rest.id;
  return rest as ConsoleCommand;
}

/** The command as `@matecrew/device-link` sends it over Bluetooth; null for those only the site relays. */
export function toRemote(command: ConsoleCommand): RemoteCommand | null {
  switch (command.kind) {
    case "key":
      return { cmd: "key", side: command.side };
    case "longKey":
      return { cmd: "longKey", side: command.side };
    case "both":
      return { cmd: "both" };
    case "badge":
      return { cmd: "badge", uid: command.uid };
    case "tap":
      return { cmd: "tap", x: command.x, y: command.y };
    case "sync":
      return command.app ? null : { cmd: "sync" };
    case "restart":
      return { cmd: "restart" };
    case "sleep":
      return { cmd: "sleep" };
    case "forgetWifi":
      return null;
  }
}
