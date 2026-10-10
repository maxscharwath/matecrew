"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-utils";
import { LINK_TTL_SECONDS, newDeviceCode, newUserCode, sha256 } from "@/lib/device/codes";

/** Wi-Fi MAC as the terminal reports it: "AC:A7:04:2B:50:E4". */
const hardwareId = z.string().regex(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);

async function requireAdmin(officeId: string) {
  const session = await requireSession();
  const membership = await prisma.membership.findUnique({
    where: { userId_officeId: { userId: session.user.id, officeId } },
    select: { roles: true },
  });
  return membership?.roles.includes("ADMIN") ? session.user.id : null;
}

type Prepared = { ok: true; secret: string; expiresIn: number } | { ok: false; error: "forbidden" | "invalid" };

/**
 * A link already approved for the terminal at hand, as when an admin types its code on /link:
 * the browser hands its device code (the secret) to the terminal over Bluetooth with the Wi-Fi,
 * and the terminal redeems it at /api/device/link/token. No code to read off the screen.
 */
export async function prepareBluetoothLink(input: { officeId: string; hardwareId: string; name: string }): Promise<Prepared> {
  const parsed = z
    .object({ officeId: z.string().min(1), hardwareId, name: z.string().trim().min(1).max(60) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const userId = await requireAdmin(parsed.data.officeId);
  if (!userId) return { ok: false, error: "forbidden" };

  const secret = newDeviceCode();
  let userCode = newUserCode();
  while (await prisma.deviceLink.findUnique({ where: { userCode }, select: { id: true } })) {
    userCode = newUserCode();
  }
  const now = new Date();
  await prisma.deviceLink.create({
    data: {
      deviceCodeHash: sha256(secret),
      userCode,
      hardwareId: parsed.data.hardwareId,
      expiresAt: new Date(now.getTime() + LINK_TTL_SECONDS * 1000),
      approvedAt: now,
      approvedById: userId,
      officeId: parsed.data.officeId,
      deviceName: parsed.data.name,
    },
  });
  return { ok: true, secret, expiresIn: LINK_TTL_SECONDS };
}

/** The terminal linked since `since` with this hardware id, once it redeemed its link. */
export async function bluetoothLinkStatus(input: { officeId: string; hardwareId: string; since: string }): Promise<{ deviceId: string } | null> {
  const parsed = z.object({ officeId: z.string().min(1), hardwareId, since: z.iso.datetime() }).safeParse(input);
  if (!parsed.success) return null;
  if (!(await requireAdmin(parsed.data.officeId))) return null;
  const device = await prisma.device.findFirst({
    where: { officeId: parsed.data.officeId, hardwareId: parsed.data.hardwareId, createdAt: { gte: new Date(parsed.data.since) } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return device ? { deviceId: device.id } : null;
}
