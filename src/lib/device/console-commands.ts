import type { DeviceCommand } from "@/lib/device/contract";

/**
 * What an admin does to a terminal from its console, and how it is stored and listed. No server
 * code: the console (a client component) lists commands with it too.
 */
export type ConsoleCommand =
  | { kind: "key"; side: "left" | "right" }
  /** Both keys together: the terminal's about page. Stored as a KEY row, arg "both". */
  | { kind: "both" }
  | { kind: "badge"; uid: string }
  | { kind: "sync"; app?: "mate" | "showcase" }
  | { kind: "tap"; x: number; y: number }
  | { kind: "restart" }
  | { kind: "forgetWifi" };

/** As a `DeviceCommand` row stores it (`prisma/schema.prisma`), and as the console lists it. */
export type CommandRow = {
  kind: "KEY" | "BADGE" | "SYNC" | "RESTART" | "FORGET_WIFI";
  arg: string | null;
};

const KIND_TO_ROW = {
  key: "KEY",
  both: "KEY",
  badge: "BADGE",
  sync: "SYNC",
  tap: "KEY",
  restart: "RESTART",
  forgetWifi: "FORGET_WIFI",
} as const;

/** What a row stores besides its kind: the side, the UID, the point or the app. */
function argOf(command: ConsoleCommand): string | null {
  switch (command.kind) {
    case "key":
      return command.side;
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
