"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { sendSlackMessage } from "@/lib/slack";

const OfficeSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  timezone: z.string().min(1).default("Europe/Zurich"),
  slackWebhookUrl: z.string().url("Invalid URL").optional().or(z.literal("")),
  slackChannelLabel: z.string().max(100).optional().or(z.literal("")),
  dailyPostTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Must be HH:mm format")
    .default("10:00"),
  lowStockThreshold: z.coerce.number().int().min(0).default(5),
});

type ActionResult = { success: true } | { success: false; error: string };

export async function updateOffice(
  officeId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");

  const parsed = OfficeSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone") || "Europe/Zurich",
    slackWebhookUrl: formData.get("slackWebhookUrl"),
    slackChannelLabel: formData.get("slackChannelLabel"),
    dailyPostTime: formData.get("dailyPostTime") || "10:00",
    lowStockThreshold: formData.get("lowStockThreshold") ?? 5,
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
        dailyPostTime: data.dailyPostTime,
        lowStockThreshold: data.lowStockThreshold,
      },
    });
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.includes("Unique constraint failed")
    ) {
      return { success: false, error: "An office with this name already exists." };
    }
    throw e;
  }

  revalidatePath(`/org/${officeId}/admin/settings`);
  return { success: true };
}

export async function testSlackWebhook(officeId: string): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");

  const office = await prisma.office.findUnique({ where: { id: officeId } });

  if (!office) {
    return { success: false, error: "Office not found." };
  }

  if (!office.slackWebhookUrl) {
    return { success: false, error: "No Slack webhook URL configured." };
  }

  try {
    await sendSlackMessage(
      office.slackWebhookUrl,
      [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Test from MateCrew*\nWebhook for *${office.name}* is working!`,
          },
        },
      ],
      `Test webhook for ${office.name}`
    );
  } catch {
    return { success: false, error: "Slack webhook failed. Check the URL." };
  }

  return { success: true };
}
