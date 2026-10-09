"use server";

import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-utils";
import { findPendingLink } from "@/lib/device/links";

type LinkResult =
  | { success: true; officeName: string; officeId: string }
  | { success: false; error: string };

export async function approveDeviceLink(formData: FormData): Promise<LinkResult> {
  const session = await requireSession();
  const t = await getTranslations();
  const parsed = z
    .object({
      code: z.string(),
      officeId: z.string().min(1),
      name: z.string().trim().min(1, t("devices.nameRequired")).max(60),
    })
    .safeParse({
      code: formData.get("code"),
      officeId: formData.get("officeId"),
      name: formData.get("name"),
    });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  // Only an admin of the chosen office may give a terminal access to it.
  const membership = await prisma.membership.findUnique({
    where: { userId_officeId: { userId: session.user.id, officeId: parsed.data.officeId } },
    include: { office: { select: { name: true } } },
  });
  if (!membership?.roles.includes("ADMIN")) {
    return { success: false, error: t("deviceLink.noAdminOffice") };
  }

  const link = await findPendingLink(parsed.data.code);
  if (!link) return { success: false, error: t("deviceLink.invalidCode") };

  await prisma.deviceLink.update({
    where: { id: link.id },
    data: {
      approvedAt: new Date(),
      approvedById: session.user.id,
      officeId: parsed.data.officeId,
      deviceName: parsed.data.name,
    },
  });
  return { success: true, officeName: membership.office.name, officeId: parsed.data.officeId };
}

export async function denyDeviceLink(code: string): Promise<{ success: boolean }> {
  await requireSession();
  const link = await findPendingLink(code);
  if (link) {
    await prisma.deviceLink.update({ where: { id: link.id }, data: { deniedAt: new Date() } });
  }
  return { success: true };
}
