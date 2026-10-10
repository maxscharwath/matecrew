import { prisma } from "@/lib/prisma";
import { COMMAND_INPUT_TTL_SECONDS, isReachable } from "@/lib/device/commands";

/** What the console shows about a terminal, refreshed every second. */
export type LiveStatus = {
  reachable: boolean;
  lastSeenAt: string | null;
  batteryMv: number | null;
  wifiRssi: number | null;
  firmwareVersion: string | null;
  frame: { hash: string; drawnAt: string } | null;
  commands: {
    id: string;
    kind: "KEY" | "BADGE" | "SYNC" | "RESTART" | "FORGET_WIFI";
    arg: string | null;
    createdAt: string;
    status: "waiting" | "delivered" | "dropped";
  }[];
};

/**
 * Also records that someone is watching, which keeps the terminal awake and polling and makes it
 * upload its screen; not with `watch: false` (the console gets the screen over Bluetooth).
 */
export async function loadLiveStatus(deviceId: string, now = new Date(), { watch = true } = {}): Promise<LiveStatus> {
  const select = { polledAt: true, lastSeenAt: true, batteryMv: true, wifiRssi: true, firmwareVersion: true } as const;
  const [device, frame, commands] = await Promise.all([
    watch
      ? prisma.device.update({ where: { id: deviceId }, data: { watchedAt: now }, select })
      : prisma.device.findUniqueOrThrow({ where: { id: deviceId }, select }),
    prisma.deviceFrame.findUnique({ where: { deviceId }, select: { hash: true, drawnAt: true } }),
    prisma.deviceCommand.findMany({
      where: { deviceId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, kind: true, arg: true, createdAt: true, deliveredAt: true },
    }),
  ]);

  const ttl = COMMAND_INPUT_TTL_SECONDS * 1000;
  return {
    reachable: isReachable(device.polledAt, now),
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    batteryMv: device.batteryMv,
    wifiRssi: device.wifiRssi,
    firmwareVersion: device.firmwareVersion,
    frame: frame && { hash: frame.hash, drawnAt: frame.drawnAt.toISOString() },
    commands: commands.map((c) => {
      const input = c.kind === "KEY" || c.kind === "BADGE";
      const late = (c.deliveredAt ?? now).getTime() - c.createdAt.getTime() > ttl;
      const status = input && late ? "dropped" : deliveryStatus(c.deliveredAt);
      return { id: c.id, kind: c.kind, arg: c.arg, createdAt: c.createdAt.toISOString(), status };
    }),
  };
}

/** Where a command that still counts stands: picked up by the terminal or not yet. */
function deliveryStatus(deliveredAt: Date | null): "delivered" | "waiting" {
  return deliveredAt ? "delivered" : "waiting";
}
