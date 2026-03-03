"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { sendSlackMessage, buildTestMessage } from "@/lib/slack";
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
    slackWebhookUrl: z.string().url(t('errors.invalidUrl')).optional().or(z.literal("")),
    slackChannelLabel: z.string().max(100).optional().or(z.literal("")),
    lowStockThreshold: z.coerce.number().int().min(0).default(30),
  });

  const parsed = OfficeSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone") || "Europe/Zurich",
    slackWebhookUrl: formData.get("slackWebhookUrl"),
    slackChannelLabel: formData.get("slackChannelLabel"),
    lowStockThreshold: formData.get("lowStockThreshold") ?? 30,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const data = parsed.data;

  try {
    await prisma.office.update({
      where: { id: officeId },
      data: {
        name: data.name,
        timezone: data.timezone,
        slackWebhookUrl: data.slackWebhookUrl || null,
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

  if (!office.slackWebhookUrl) {
    return { success: false, error: t('errors.noSlackWebhook') };
  }

  try {
    const { blocks, fallback } = await buildTestMessage(office.name, office.locale);
    await sendSlackMessage(office.slackWebhookUrl, blocks, fallback);
  } catch {
    return { success: false, error: t('errors.slackFailed') };
  }

  return { success: true };
}
