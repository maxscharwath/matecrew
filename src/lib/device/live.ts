import { prisma } from "@/lib/prisma";
import { platform } from "@/platform";
import { COMMAND_INPUT_TTL_SECONDS, isReachable } from "@/lib/device/commands";
import type { Presence } from "../../../realtime/src/protocol";

/** What the console shows about a terminal, refreshed every second. */
export type LiveStatus = {
  reachable: boolean;
  /** Offline because it sleeps (deep sleep between uses, or its night): not gone. */
  asleep: boolean;
  /** When it wakes up by itself, ISO 8601; null without a time (a key wakes it). */
  asleepUntil: string | null;
  lastSeenAt: string | null;
  batteryMv: number | null;
  wifiRssi: number | null;
  firmwareVersion: string | null;
  frame: { hash: string; drawnAt: string } | null;
  commands: {
    id: string;
    kind: "KEY" | "BADGE" | "SYNC" | "RESTART" | "FORGET_WIFI" | "SLEEP";
    arg: string | null;
    createdAt: string;
    status: "waiting" | "delivered" | "dropped";
  }[];
};

/** What the relay knows of a terminal over what the site last recorded: whether it is connected now, its last report. */
export function withPresence(
  recorded: { polledAt: Date | null; lastSeenAt: Date | null; batteryMv: number | null; wifiRssi: number | null; firmwareVersion: string | null },
  presence: Presence | null | undefined,
  now = new Date(),
) {
  if (!presence) {
    return { ...recorded, reachable: isReachable(recorded.polledAt, now) };
  }
  const { status, statusAt, online } = presence;
  const heard = Math.max(recorded.lastSeenAt?.getTime() ?? 0, statusAt ?? 0);
  const lastHeard = heard > 0 ? new Date(heard) : null;
  return {
    ...recorded,
    reachable: online,
    lastSeenAt: online ? now : lastHeard,
    batteryMv: typeof status?.batteryMv === "number" ? status.batteryMv : recorded.batteryMv,
    wifiRssi: typeof status?.rssi === "number" ? status.rssi : recorded.wifiRssi,
    firmwareVersion: typeof status?.firmware === "string" ? status.firmware : recorded.firmwareVersion,
  };
}

/**
 * With the realtime relay, the terminal's presence and last report come from it, and the console
 * gets the rest over its socket. Without one, also records that someone is watching, which keeps
 * the terminal awake and polling and makes it upload its screen; not with `watch: false` (the
 * console gets the screen over Bluetooth).
 */
export async function loadLiveStatus(deviceId: string, now = new Date(), { watch = true } = {}): Promise<LiveStatus> {
  const presence = (await platform.relay.presence([deviceId]))?.get(deviceId) ?? null;
  watch &&= presence === null;
  const select = { polledAt: true, lastSeenAt: true, batteryMv: true, wifiRssi: true, firmwareVersion: true } as const;
  const [recorded, stored, commands] = await Promise.all([
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
  const device = withPresence(recorded, presence, now);
  // The relay's screen when it has one ("r" + when: the frame route serves it), else the site's.
  const frame = presence?.drawnAt ? { hash: `r${presence.drawnAt}`, drawnAt: new Date(presence.drawnAt) } : stored;
  return {
    reachable: device.reachable,
    asleep: presence?.asleep ?? false,
    asleepUntil: presence?.asleepUntil ? new Date(presence.asleepUntil).toISOString() : null,
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
