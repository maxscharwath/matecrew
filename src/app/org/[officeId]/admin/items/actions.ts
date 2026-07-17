"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { uploadFile, deleteFile, buildItemImageKey } from "@/lib/storage";
import { optimizeImage } from "@/lib/image";

type ActionResult = { success: true } | { success: false; error: string };

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

function revalidateItemPages(officeId: string) {
  revalidatePath(`/org/${officeId}/admin/items`);
  revalidatePath(`/org/${officeId}/admin/stock`);
  revalidatePath(`/org/${officeId}/admin/purchases`);
  revalidatePath(`/org/${officeId}/request`);
  revalidatePath(`/org/${officeId}/dashboard`);
}

export async function createItem(
  officeId: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const parsed = z
    .object({ name: z.string().trim().min(1, t("items.nameRequired")).max(60) })
    .safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const existing = await prisma.item.findUnique({
    where: { officeId_name: { officeId, name: parsed.data.name } },
    select: { id: true },
  });
  if (existing) {
    return { success: false, error: t("items.nameExists") };
  }

  const maxSort = await prisma.item.aggregate({
    where: { officeId },
    _max: { sortOrder: true },
  });

  // A brand-new item starts with an empty stock pool.
  await prisma.item.create({
    data: {
      officeId,
      name: parsed.data.name,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      stock: { create: { officeId, currentQty: 0 } },
    },
  });

  revalidateItemPages(officeId);
  return { success: true };
}

export async function renameItem(
  officeId: string,
  itemId: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const parsed = z
    .object({ name: z.string().trim().min(1, t("items.nameRequired")).max(60) })
    .safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const item = await prisma.item.findFirst({
    where: { id: itemId, officeId },
    select: { id: true },
  });
  if (!item) return { success: false, error: t("errors.itemNotFound") };

  const clash = await prisma.item.findFirst({
    where: { officeId, name: parsed.data.name, id: { not: itemId } },
    select: { id: true },
  });
  if (clash) return { success: false, error: t("items.nameExists") };

  await prisma.item.update({
    where: { id: itemId },
    data: { name: parsed.data.name },
  });

  revalidateItemPages(officeId);
  return { success: true };
}

export async function setItemActive(
  officeId: string,
  itemId: string,
  active: boolean,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const item = await prisma.item.findFirst({
    where: { id: itemId, officeId },
    select: { id: true, isDefault: true },
  });
  if (!item) return { success: false, error: t("errors.itemNotFound") };

  // The default item is what every fallback flow relies on, so it can't be
  // archived while it's still the default.
  if (!active && item.isDefault) {
    return { success: false, error: t("items.cannotArchiveDefault") };
  }

  await prisma.item.update({
    where: { id: itemId },
    data: { active },
  });

  revalidateItemPages(officeId);
  return { success: true };
}

export async function setItemImage(
  officeId: string,
  itemId: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const item = await prisma.item.findFirst({
    where: { id: itemId, officeId },
    select: { id: true, imageKey: true },
  });
  if (!item) return { success: false, error: t("errors.itemNotFound") };

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: t("errors.invalidFileType", { name: "" }) };
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { success: false, error: t("errors.invalidFileType", { name: file.name }) };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { success: false, error: t("errors.fileTooLarge", { name: file.name }) };
  }

  let buffer: Buffer;
  try {
    buffer = await optimizeImage(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { success: false, error: t("errors.invalidFileType", { name: file.name }) };
  }
  const key = buildItemImageKey(itemId, "image.webp");
  await uploadFile({ key, body: buffer, contentType: "image/webp" });

  await prisma.item.update({ where: { id: itemId }, data: { imageKey: key } });

  // Best-effort cleanup of the previous image.
  if (item.imageKey) deleteFile(item.imageKey).catch(() => {});

  revalidateItemPages(officeId);
  return { success: true };
}

export async function removeItemImage(
  officeId: string,
  itemId: string,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const item = await prisma.item.findFirst({
    where: { id: itemId, officeId },
    select: { id: true, imageKey: true },
  });
  if (!item) return { success: false, error: t("errors.itemNotFound") };

  await prisma.item.update({ where: { id: itemId }, data: { imageKey: null } });
  if (item.imageKey) deleteFile(item.imageKey).catch(() => {});

  revalidateItemPages(officeId);
  return { success: true };
}

export async function setItemNutrition(
  officeId: string,
  itemId: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const parsed = z
    .object({
      volumeMl: z.coerce.number().int().min(0).max(5000),
      sugarGrams: z.coerce.number().min(0).max(500),
      caffeineMg: z.coerce.number().min(0).max(2000),
    })
    .safeParse({
      volumeMl: formData.get("volumeMl"),
      sugarGrams: formData.get("sugarGrams"),
      caffeineMg: formData.get("caffeineMg"),
    });
  if (!parsed.success) {
    return { success: false, error: t("items.nutritionInvalid") };
  }

  const item = await prisma.item.findFirst({
    where: { id: itemId, officeId },
    select: { id: true },
  });
  if (!item) return { success: false, error: t("errors.itemNotFound") };

  await prisma.item.update({
    where: { id: itemId },
    data: parsed.data,
  });

  revalidateItemPages(officeId);
  revalidatePath(`/org/${officeId}/stats`);
  return { success: true };
}

export async function setDefaultItem(
  officeId: string,
  itemId: string,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const item = await prisma.item.findFirst({
    where: { id: itemId, officeId, active: true },
    select: { id: true },
  });
  if (!item) return { success: false, error: t("errors.itemNotFound") };

  // Exactly one default per office.
  await prisma.$transaction([
    prisma.item.updateMany({
      where: { officeId, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.item.update({
      where: { id: itemId },
      data: { isDefault: true },
    }),
  ]);

  revalidateItemPages(officeId);
  return { success: true };
}
