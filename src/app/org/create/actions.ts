"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-utils";
import { getTranslations } from "next-intl/server";

type CreateResult =
  | { success: true; officeId: string }
  | { success: false; error: string };

export async function createOffice(formData: FormData): Promise<CreateResult> {
  const session = await requireSession();
  const t = await getTranslations();

  const CreateOfficeSchema = z.object({
    name: z.string().min(1, t("errors.nameRequired")).max(100),
    timezone: z.string().min(1).default("Europe/Zurich"),
  });

  const parsed = CreateOfficeSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone") || "Europe/Zurich",
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const office = await prisma.office.create({
      data: {
        name: parsed.data.name,
        timezone: parsed.data.timezone,
      },
    });

    await prisma.$transaction([
      prisma.membership.create({
        data: {
          userId: session.user.id,
          officeId: office.id,
          roles: ["ADMIN"],
        },
      }),
      prisma.stock.create({
        data: { officeId: office.id, currentQty: 0 },
      }),
      prisma.user.updateMany({
        where: { id: session.user.id, defaultOfficeId: null },
        data: { defaultOfficeId: office.id },
      }),
    ]);

    return { success: true, officeId: office.id };
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.includes("Unique constraint failed")
    ) {
      return { success: false, error: t("errors.officeNameExists") };
    }
    throw e;
  }
}
