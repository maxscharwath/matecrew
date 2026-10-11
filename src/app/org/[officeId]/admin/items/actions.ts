"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { BatchConflictError, commitBatch, expectRows, newId, prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { buildItemImageKey } from "@/lib/storage";
import { platform } from "@/platform";
import { ITEM_IMAGE_BYTES, loadPhoto, needsTerminalPhoto, photoToTerminal, pictureToBitmap } from "@/lib/device/bitmap";

type ActionResult = { success: true } | { success: false; error: string };

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
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

  // A brand-new item starts with an empty stock pool: both rows in one atomic
  // batch. The name was checked above; one created in between is a unique-key
  // conflict that rolls the batch back.
  const id = newId();
  try {
    await commitBatch((db) => [
      db.item.createMany({
        data: [{ id, officeId, name: parsed.data.name, sortOrder: (maxSort._max.sortOrder ?? 0) + 1 }],
      }),
      db.stock.createMany({ data: [{ officeId, itemId: id, currentQty: 0 }] }),
    ]);
  } catch (error) {
    if (error instanceof BatchConflictError) return { success: false, error: t("items.nameExists") };
    throw error;
  }

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
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return { success: false, error: t("errors.invalidFileType", { name: file.name }) };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { success: false, error: t("errors.fileTooLarge", { name: file.name }) };
  }

  let photo: Uint8Array;
  let terminalPhoto: Uint8Array<ArrayBuffer>;
  try {
    photo = await platform.images.optimizeForWeb(new Uint8Array(await file.arrayBuffer()));
    // Worked out now, from the stored photo, so the terminal never decodes a picture.
    terminalPhoto = await photoToTerminal(photo);
  } catch {
    return { success: false, error: t("errors.invalidFileType", { name: file.name }) };
  }
  const key = buildItemImageKey(itemId, "image.webp");
  await platform.storage.put(key, photo, { contentType: "image/webp" });

  await prisma.item.update({ where: { id: itemId }, data: { imageKey: key, terminalPhoto } });

  // Best-effort cleanup of the previous image.
  if (item.imageKey) platform.runInBackground(platform.storage.delete(item.imageKey), "item image cleanup");

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

  await prisma.item.update({ where: { id: itemId }, data: { imageKey: null, terminalPhoto: null } });
  if (item.imageKey) platform.runInBackground(platform.storage.delete(item.imageKey), "item image cleanup");

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

/** `#rrggbb`, lowercase or upper — the shape an `<input type="color">` emits. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Pins an item's chart colour, or clears it back to the palette. Null rather
 * than a copy of the palette hue, so an item left on "automatic" keeps
 * following its rank as the office's mix changes.
 */
export async function setItemColor(
  officeId: string,
  itemId: string,
  color: string | null,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const parsed = z
    .object({ color: z.string().regex(HEX_COLOR).nullable() })
    .safeParse({ color });
  if (!parsed.success) {
    return { success: false, error: t("items.colorInvalid") };
  }

  const item = await prisma.item.findFirst({
    where: { id: itemId, officeId },
    select: { id: true },
  });
  if (!item) return { success: false, error: t("errors.itemNotFound") };

  await prisma.item.update({
    where: { id: itemId },
    data: { color: parsed.data.color?.toLowerCase() ?? null },
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

  // Exactly one default per office, in one atomic batch. The guard only
  // promotes the item while it is still active; archived in between, the
  // batch is rolled back and the old default stays.
  try {
    await commitBatch((db) => [
      db.item.updateMany({
        where: { officeId, isDefault: true },
        data: { isDefault: false },
      }),
      expectRows(
        db.item.updateMany({
          where: { id: itemId, officeId, active: true },
          data: { isDefault: true },
        }),
        1,
      ),
    ]);
  } catch (error) {
    if (error instanceof BatchConflictError) return { success: false, error: t("errors.itemNotFound") };
    throw error;
  }

  revalidateItemPages(officeId);
  return { success: true };
}

type PictureResult = { success: true; bits: string } | { success: false; error: string };

/**
 * An uploaded picture as the terminal's 96 x 96 black and white, for the
 * editor to show before anything is saved. A drawing keeps sharp edges; a
 * photo can be dithered instead.
 */
export async function terminalImageFromFile(
  officeId: string,
  formData: FormData,
): Promise<PictureResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0 || !ALLOWED_IMAGE_TYPES.has(file.type)) {
    return { success: false, error: t("errors.invalidFileType", { name: file instanceof File ? file.name : "" }) };
  }
  if (file.size > MAX_IMAGE_SIZE) return { success: false, error: t("errors.fileTooLarge", { name: file.name }) };
  try {
    const mode = formData.get("mode") === "dither" ? "dither" : "threshold";
    const picture = await pictureToBitmap(new Uint8Array(await file.arrayBuffer()), mode);
    return { success: true, bits: Buffer.from(picture.bits).toString("base64") };
  } catch {
    return { success: false, error: t("errors.invalidFileType", { name: file.name }) };
  }
}

/**
 * The item's photo at 96 x 96 in black and white, as a start for drawing. Worked out and kept
 * now when the photo has none yet, or one from before photos were dithered.
 */
export async function terminalImageFromPhoto(officeId: string, itemId: string): Promise<PictureResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();
  const item = await prisma.item.findFirst({
    where: { id: itemId, officeId },
    select: { imageKey: true, terminalPhoto: true },
  });
  if (!item) return { success: false, error: t("errors.itemNotFound") };
  if (!item.imageKey) return { success: false, error: t("items.terminalImage.noPhoto") };
  // The ink only: the editor draws in black and white, the opacity follows the drawing.
  const bits = (picture: Uint8Array) => Buffer.from(picture.subarray(0, ITEM_IMAGE_BYTES)).toString("base64");
  if (item.terminalPhoto && !needsTerminalPhoto(item.imageKey, item.terminalPhoto)) {
    return { success: true, bits: bits(item.terminalPhoto) };
  }
  try {
    const terminalPhoto = await photoToTerminal(await loadPhoto(item.imageKey));
    await prisma.item.update({ where: { id: itemId }, data: { terminalPhoto } });
    revalidateItemPages(officeId);
    return { success: true, bits: bits(terminalPhoto) };
  } catch (error) {
    console.error(`[items] terminal picture of ${itemId} failed`, error);
    return { success: false, error: t("items.terminalImage.photoFailed") };
  }
}

/**
 * Works out the terminal picture of every photo in the office that has none, or one from before
 * photos were dithered: photos stored before pictures were computed at upload, as copied from the
 * previous hosting. Run once from the items page; then nothing is left to do.
 */
export async function computeTerminalPhotos(officeId: string): Promise<{ computed: number; failed: number }> {
  await requireOrgRoles(officeId, "ADMIN");
  const photos = await prisma.item.findMany({
    where: { officeId, imageKey: { not: null } },
    select: { id: true, imageKey: true, terminalPhoto: true },
  });
  const items = photos.filter((item) => needsTerminalPhoto(item.imageKey, item.terminalPhoto));
  const results = await Promise.allSettled(
    items.map(async ({ id, imageKey }) => {
      const terminalPhoto = await photoToTerminal(await loadPhoto(imageKey ?? ""));
      await prisma.item.update({ where: { id }, data: { terminalPhoto } });
    }),
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed < results.length) revalidateItemPages(officeId);
  return { computed: results.length - failed, failed };
}

/** Saves the terminal's picture of the item; null goes back to the dithered photo. */
export async function setTerminalImage(
  officeId: string,
  itemId: string,
  bits: string | null,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();
  const bytes = bits === null ? null : Buffer.from(bits, "base64");
  if (bytes && bytes.length !== ITEM_IMAGE_BYTES) return { success: false, error: t("errors.itemNotFound") };
  const updated = await prisma.item.updateMany({
    where: { id: itemId, officeId },
    data: { terminalImage: bytes ? Uint8Array.from(bytes) : null },
  });
  if (updated.count === 0) return { success: false, error: t("errors.itemNotFound") };
  revalidateItemPages(officeId);
  return { success: true };
}
