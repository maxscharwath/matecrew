"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { normalizeBadgeUid } from "@/lib/device/codes";
import { toRow, type ConsoleCommand } from "@/lib/device/commands";
import type { LiveStatus } from "@/lib/device/live";

type ActionResult = { success: true } | { success: false; error: string };

function revalidateDevices(officeId: string) {
  revalidatePath(`/org/${officeId}/admin/devices`);
}

export async function updateDevice(
  officeId: string,
  deviceId: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations("devices");

  const parsed = z
    .object({
      name: z.string().trim().min(1, t("nameRequired")).max(60),
      firstItemId: z.string().min(1).nullable(),
    })
    .safeParse({ name: formData.get("name"), firstItemId: formData.get("firstItemId") });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const device = await prisma.device.findFirst({ where: { id: deviceId, officeId }, select: { id: true } });
  if (!device) return { success: false, error: t("notFound") };
  const { name, firstItemId } = parsed.data;
  if (firstItemId && !(await prisma.item.count({ where: { id: firstItemId, officeId } }))) {
    return { success: false, error: t("notFound") };
  }

  // The picker opens on the left key's item; that is all the keys still have to set.
  await prisma.device.update({ where: { id: deviceId }, data: { name, leftItemId: firstItemId } });
  revalidateDevices(officeId);
  return { success: true };
}

/** Deleting the device deletes its token hash: its next call gets a 401 and it starts linking again. */
export async function revokeDevice(officeId: string, deviceId: string): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  await prisma.device.deleteMany({ where: { id: deviceId, officeId } });
  revalidateDevices(officeId);
  return { success: true };
}

export async function assignBadge(
  officeId: string,
  badgeId: string,
  userId: string | null,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations("devices");
  if (userId) {
    const member = await prisma.membership.findUnique({
      where: { userId_officeId: { userId, officeId } },
      select: { id: true },
    });
    if (!member) return { success: false, error: t("notFound") };
  }
  const updated = await prisma.badge.updateMany({ where: { id: badgeId, officeId }, data: { userId } });
  if (updated.count === 0) return { success: false, error: t("notFound") };
  revalidateDevices(officeId);
  return { success: true };
}

const consoleCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("key"), side: z.enum(["left", "right"]) }),
  z.object({ kind: z.literal("badge"), uid: z.string() }),
  z.object({ kind: z.literal("sync"), app: z.enum(["mate", "showcase"]).optional() }),
  z.object({ kind: z.literal("tap"), x: z.number().int().min(0).max(199), y: z.number().int().min(0).max(119) }),
  z.object({ kind: z.literal("restart") }),
  z.object({ kind: z.literal("forgetWifi") }),
]);

/**
 * Queues a command from the console; the terminal picks it up on its next
 * poll. Returns it as the console's monitor lists it, waiting.
 */
export async function sendDeviceCommand(
  officeId: string,
  deviceId: string,
  input: ConsoleCommand,
): Promise<{ success: true; command: LiveStatus["commands"][number] } | { success: false; error: string }> {
  const { session } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations("devices");
  const parsed = consoleCommand.safeParse(input);
  if (!parsed.success) return { success: false, error: t("notFound") };

  let command: ConsoleCommand = parsed.data;
  if (command.kind === "badge") {
    const uid = normalizeBadgeUid(command.uid);
    if (!uid) return { success: false, error: t("console.invalidUid") };
    command = { kind: "badge", uid };
  }

  const device = await prisma.device.findFirst({ where: { id: deviceId, officeId }, select: { id: true } });
  if (!device) return { success: false, error: t("notFound") };
  const row = await prisma.deviceCommand.create({
    data: { deviceId, sentById: session.user.id, ...toRow(command) },
    select: { id: true, kind: true, arg: true, createdAt: true },
  });
  return { success: true, command: { ...row, createdAt: row.createdAt.toISOString(), status: "waiting" } };
}
