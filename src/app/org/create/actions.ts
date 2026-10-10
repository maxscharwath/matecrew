"use server";

import { z } from "zod";
import { BatchConflictError, commitBatch, newId } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-utils";
import { createMembershipWrites } from "@/lib/membership-roles";
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

  const officeId = newId();
  const defaultItemId = newId();
  // One atomic batch: the office, its default item (every office starts with
  // one so the request and stock flows have something to attach to) and that
  // item's stock pool, the creator's admin membership, and their default
  // office if they had none. A taken name rolls it all back.
  try {
    await commitBatch((db) => [
      db.office.createMany({
        data: [{ id: officeId, name: parsed.data.name, timezone: parsed.data.timezone }],
      }),
      db.item.createMany({
        data: [{ id: defaultItemId, officeId, name: t("items.defaultItemName"), isDefault: true }],
      }),
      db.stock.createMany({ data: [{ officeId, itemId: defaultItemId, currentQty: 0 }] }),
      ...createMembershipWrites(db, { id: newId(), userId: session.user.id, officeId, roles: ["ADMIN"] }),
      db.user.updateMany({
        where: { id: session.user.id, defaultOfficeId: null },
        data: { defaultOfficeId: officeId },
      }),
    ]);
  } catch (e) {
    if (e instanceof BatchConflictError && e.reason === "unique") {
      return { success: false, error: t("errors.officeNameExists") };
    }
    throw e;
  }

  return { success: true, officeId };
}
