import { setTimeout as sleep } from "node:timers/promises";
import { prisma } from "@/lib/prisma";
import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { COMMAND_WAIT_MAX_SECONDS, isWatched, takeCommands } from "@/lib/device/commands";
import type { CommandsResponse } from "@/lib/device/contract";

export const maxDuration = 60;

/**
 * What an admin did from the console. With `?wait=N` the request is held up
 * to N seconds until something arrives, so a key pressed on the site reaches
 * an awake terminal within a second.
 */
export async function GET(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();

  const wait = Math.min(Math.max(Number(new URL(request.url).searchParams.get("wait")) || 0, 0), COMMAND_WAIT_MAX_SECONDS);
  const deadline = Date.now() + wait * 1000;
  const now = new Date();
  await prisma.device.update({ where: { id: device.id }, data: { polledAt: now, lastSeenAt: now } });

  for (;;) {
    const commands = await takeCommands(device.id);
    if (commands.length > 0 || Date.now() >= deadline || request.signal.aborted) {
      const { watchedAt } = await prisma.device.findUniqueOrThrow({
        where: { id: device.id },
        select: { watchedAt: true },
      });
      return Response.json({ commands, live: isWatched(watchedAt) } satisfies CommandsResponse);
    }
    await sleep(500);
  }
}
