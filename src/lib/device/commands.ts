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
  | { kind: "badge"; uid: string }
  | { kind: "sync" }
  | { kind: "restart" }
  | { kind: "forgetWifi" };

const KIND_TO_ROW = {
  key: "KEY",
  badge: "BADGE",
  sync: "SYNC",
  restart: "RESTART",
  forgetWifi: "FORGET_WIFI",
} as const;

export function toRow(command: ConsoleCommand): { kind: CommandRow["kind"]; arg: string | null } {
  const arg = command.kind === "key" ? command.side : command.kind === "badge" ? command.uid : null;
  return { kind: KIND_TO_ROW[command.kind], arg };
}

export function toWire(row: Pick<CommandRow, "id" | "kind" | "arg">): DeviceCommand | null {
  switch (row.kind) {
    case "KEY":
      return row.arg === "left" || row.arg === "right" ? { id: row.id, kind: "key", side: row.arg } : null;
    case "BADGE":
      return row.arg ? { id: row.id, kind: "badge", uid: row.arg } : null;
    case "SYNC":
      return { id: row.id, kind: "sync" };
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
export async function takeCommands(deviceId: string, now = new Date()): Promise<DeviceCommand[]> {
  const rows = await prisma.deviceCommand.updateManyAndReturn({
    where: { deviceId, deliveredAt: null },
    data: { deliveredAt: now },
  });
  const staleBefore = now.getTime() - COMMAND_INPUT_TTL_SECONDS * 1000;
  return rows
    .filter((row) => !((row.kind === "KEY" || row.kind === "BADGE") && row.createdAt.getTime() < staleBefore))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(toWire)
    .filter((command): command is DeviceCommand => command !== null);
}

export function isReachable(polledAt: Date | null, now = new Date()): boolean {
  return polledAt !== null && now.getTime() - polledAt.getTime() < REACHABLE_SECONDS * 1000;
}

export function isWatched(watchedAt: Date | null, now = new Date()): boolean {
  return watchedAt !== null && now.getTime() - watchedAt.getTime() < WATCHED_SECONDS * 1000;
}

export function frameHash(bits: Uint8Array): string {
  return createHash("sha256").update(bits).digest("base64url").slice(0, 22);
}
