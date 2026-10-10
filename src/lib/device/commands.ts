import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { DeviceCommand as CommandRow } from "@/generated/prisma/client";
import type { DeviceCommand } from "@/lib/device/contract";

/** A key or badge pressed from the console is dropped if the terminal picks it up later than this. */
export const COMMAND_INPUT_TTL_SECONDS = 60;
/** Longest a terminal's command poll is held open. */
export const COMMAND_WAIT_MAX_SECONDS = 25;
/** A terminal that polled this recently is reachable now: its poll lasts up to 25 s. */
const REACHABLE_SECONDS = COMMAND_WAIT_MAX_SECONDS + 15;
/** The console polls every second; past this the terminal may go back to sleep. */
const WATCHED_SECONDS = 30;

export const FRAME_BYTES = (800 * 480) / 8;

export type ConsoleCommand =
  | { kind: "key"; side: "left" | "right" }
  /** Both keys together: the terminal's about page. Stored as a KEY row, arg "both". */
  | { kind: "both" }
  | { kind: "badge"; uid: string }
  | { kind: "sync"; app?: "mate" | "showcase" }
  | { kind: "tap"; x: number; y: number }
  | { kind: "restart" }
  | { kind: "forgetWifi" };

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

export function toRow(command: ConsoleCommand): {
  kind: CommandRow["kind"];
  arg: string | null;
} {
  return { kind: KIND_TO_ROW[command.kind], arg: argOf(command) };
}

export function toWire(
  row: Pick<CommandRow, "id" | "kind" | "arg">,
): DeviceCommand | null {
  switch (row.kind) {
    case "KEY": {
      const tap = /^tap:(\d{1,3}):(\d{1,3})$/.exec(row.arg ?? "");
      if (tap && Number(tap[1]) < 200 && Number(tap[2]) < 120)
        return {
          id: row.id,
          kind: "tap",
          x: Number(tap[1]),
          y: Number(tap[2]),
        };
      if (row.arg === "both") return { id: row.id, kind: "both" };
      return row.arg === "left" || row.arg === "right"
        ? { id: row.id, kind: "key", side: row.arg }
        : null;
    }
    case "BADGE":
      return row.arg ? { id: row.id, kind: "badge", uid: row.arg } : null;
    case "SYNC":
      return {
        id: row.id,
        kind: "sync",
        ...(row.arg === "app:mate" || row.arg === "app:showcase"
          ? { app: row.arg.slice(4) as "mate" | "showcase" }
          : {}),
      };
    case "RESTART":
      return { id: row.id, kind: "restart" };
    case "FORGET_WIFI":
      return { id: row.id, kind: "forgetWifi" };
  }
}

/**
 * Marks every waiting command delivered and returns those still worth
 * running, oldest first. One statement, so two polls never get the same one.
 */
export async function takeCommands(
  deviceId: string,
  now = new Date(),
): Promise<DeviceCommand[]> {
  const rows = await prisma.deviceCommand.updateManyAndReturn({
    where: { deviceId, deliveredAt: null },
    data: { deliveredAt: now },
  });
  const staleBefore = now.getTime() - COMMAND_INPUT_TTL_SECONDS * 1000;
  return rows
    .filter(
      (row) =>
        !(
          (row.kind === "KEY" || row.kind === "BADGE") &&
          row.createdAt.getTime() < staleBefore
        ),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(toWire)
    .filter((command): command is DeviceCommand => command !== null);
}

export function isReachable(polledAt: Date | null, now = new Date()): boolean {
  return (
    polledAt !== null &&
    now.getTime() - polledAt.getTime() < REACHABLE_SECONDS * 1000
  );
}

export function isWatched(watchedAt: Date | null, now = new Date()): boolean {
  return (
    watchedAt !== null &&
    now.getTime() - watchedAt.getTime() < WATCHED_SECONDS * 1000
  );
}

export function frameHash(bits: Uint8Array): string {
  return createHash("sha256").update(bits).digest("base64url").slice(0, 22);
}
