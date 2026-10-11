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

import { fromRow, withId } from "@/lib/device/console-commands";

export { toRow, type ConsoleCommand } from "@/lib/device/console-commands";

/** A stored row as the terminal runs it; null for one that makes no command. */
export function toWire(row: Pick<CommandRow, "id" | "kind" | "arg">): DeviceCommand | null {
  const command = fromRow(row);
  return command && withId(command, row.id);
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
