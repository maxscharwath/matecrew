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

/** Also records that someone is watching, which keeps the terminal awake and polling. */
export async function loadLiveStatus(deviceId: string, now = new Date()): Promise<LiveStatus> {
  const [device, frame, commands] = await Promise.all([
    prisma.device.update({
      where: { id: deviceId },
      data: { watchedAt: now },
      select: { polledAt: true, lastSeenAt: true, batteryMv: true, wifiRssi: true, firmwareVersion: true },
    }),
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
      const status = input && late ? "dropped" : c.deliveredAt ? "delivered" : "waiting";
      return { id: c.id, kind: c.kind, arg: c.arg, createdAt: c.createdAt.toISOString(), status };
    }),
  };
}
