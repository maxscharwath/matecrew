"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";

type ActionResult = { success: true } | { success: false; error: string };

const SYNC_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

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

  const optionalId = z
    .string()
    .transform((v) => (v === "" || v === "none" ? null : v))
    .nullable();
  const parsed = z
    .object({
      name: z.string().trim().min(1, t("nameRequired")).max(60),
      leftAction: z.enum(["TAKE", "RETURN"]),
      leftItemId: optionalId,
      leftLabel: z.string().trim().max(40),
      rightAction: z.enum(["TAKE", "RETURN"]),
      rightItemId: optionalId,
      rightLabel: z.string().trim().max(40),
      syncTimes: z
        .string()
        .transform((v) => v.split(/[,\s]+/).filter(Boolean))
        .refine((times) => times.length > 0 && times.length <= 24 && times.every((x) => SYNC_TIME.test(x)), {
          message: t("invalidSyncTimes"),
        }),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const device = await prisma.device.findFirst({ where: { id: deviceId, officeId }, select: { id: true } });
  if (!device) return { success: false, error: t("notFound") };

  const { leftItemId, rightItemId } = parsed.data;
  const itemIds = [leftItemId, rightItemId].filter((id): id is string => id !== null);
  const known = await prisma.item.count({ where: { id: { in: itemIds }, officeId } });
  if (known !== new Set(itemIds).size) return { success: false, error: t("notFound") };

  await prisma.device.update({
    where: { id: deviceId },
    data: {
      ...parsed.data,
      leftLabel: parsed.data.leftLabel || null,
      rightLabel: parsed.data.rightLabel || null,
      syncTimes: [...new Set(parsed.data.syncTimes)].sort(),
    },
  });
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
