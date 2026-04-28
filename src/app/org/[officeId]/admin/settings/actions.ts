"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { sendSlackMessage, buildTestMessage } from "@/lib/slack";
import { deleteFile } from "@/lib/storage";
import { trySyncSessionSchedules } from "@/lib/schedule-sync";
import { getTranslations } from "next-intl/server";

type ActionResult = { success: true } | { success: false; error: string };

export async function updateOffice(
  officeId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const OfficeSchema = z.object({
    name: z.string().min(1, t('errors.nameRequired')).max(100),
    timezone: z.string().min(1).default("Europe/Zurich"),
    slackChannelId: z.string().max(100).optional().or(z.literal("")),
    slackChannelLabel: z.string().max(100).optional().or(z.literal("")),
    lowStockThreshold: z.coerce.number().int().min(0).default(30),
  });

  const parsed = OfficeSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone") || "Europe/Zurich",
    slackChannelId: formData.get("slackChannelId"),
    slackChannelLabel: formData.get("slackChannelLabel"),
    lowStockThreshold: formData.get("lowStockThreshold") ?? 30,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const data = parsed.data;

  const before = await prisma.office.findUnique({
    where: { id: officeId },
    select: { timezone: true, slackChannelId: true },
  });

  try {
    await prisma.office.update({
      where: { id: officeId },
      data: {
        name: data.name,
        timezone: data.timezone,
        slackChannelId: data.slackChannelId || null,
        slackChannelLabel: data.slackChannelLabel || null,
        lowStockThreshold: data.lowStockThreshold,
      },
    });
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.includes("Unique constraint failed")
    ) {
      return { success: false, error: t('errors.officeNameExists') };
    }
    throw e;
  }

  // Timezone shifts UTC slot for every session; slack channel toggles whether
  // the office is included in the desired schedule set at all.
  const newSlackId = data.slackChannelId || null;
  if (
    before?.timezone !== data.timezone ||
    before?.slackChannelId !== newSlackId
  ) {
    await trySyncSessionSchedules();
  }

  revalidatePath(`/org/${officeId}/admin/settings`);
  return { success: true };
}

export async function testSlackWebhook(officeId: string): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const office = await prisma.office.findUnique({ where: { id: officeId } });

  if (!office) {
    return { success: false, error: t('errors.officeNotFound') };
  }

  if (!office.slackChannelId) {
    return { success: false, error: t('errors.noSlackChannel') };
  }

  try {
    const { blocks, fallback } = await buildTestMessage(office.name, office.locale);
    await sendSlackMessage(office.slackChannelId, blocks, fallback);
  } catch {
    return { success: false, error: t('errors.slackFailed') };
  }

  return { success: true };
}

export async function deleteOffice(officeId: string): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const office = await prisma.office.findUnique({
    where: { id: officeId },
    include: {
      purchaseBatches: {
        include: { invoices: { select: { storageKey: true } } },
      },
    },
  });

  if (!office) {
    return { success: false, error: t("errors.officeNotFound") };
  }

  // Delete invoice files from storage before cascade delete
  const storageKeys = office.purchaseBatches.flatMap((b) =>
    b.invoices.map((i) => i.storageKey)
  );

  await Promise.allSettled(storageKeys.map((key) => deleteFile(key)));

  // Cascade delete handles all related records (see schema onDelete: Cascade)
  await prisma.office.delete({ where: { id: officeId } });

  await trySyncSessionSchedules();
  redirect("/");
}
