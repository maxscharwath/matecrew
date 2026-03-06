"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-utils";
import { setLocaleCookie } from "@/lib/locale";
import { type Locale, locales } from "@/i18n/request";
import { uploadFile, deleteFile, buildAvatarKey } from "@/lib/storage";

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg"];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

const UpdateProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  locale: z.enum([...locales]),
  defaultOfficeId: z.string().optional(),
});

type ActionResult = { success: true } | { success: false; error: string };

export async function updateProfile(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const userId = session.user.id;

  const parsed = UpdateProfileSchema.safeParse({
    name: formData.get("name"),
    locale: formData.get("locale"),
    defaultOfficeId: formData.get("defaultOfficeId") || undefined,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { name, locale, defaultOfficeId } = parsed.data;

  if (defaultOfficeId) {
    const membership = await prisma.membership.findUnique({
      where: { userId_officeId: { userId, officeId: defaultOfficeId } },
    });
    if (!membership) {
      return { success: false, error: "Invalid office" };
    }
  }

  const avatarFile = formData.get("avatar") as File | null;
  const removeAvatar = formData.get("removeAvatar") === "true";
  let imageUpdate: { image: string } | { image: null } | Record<string, never> = {};

  if (avatarFile && avatarFile.size > 0) {
    if (!ALLOWED_MIME_TYPES.includes(avatarFile.type)) {
      return { success: false, error: "Invalid file type. Allowed: PNG, JPG." };
    }
    if (avatarFile.size > MAX_FILE_SIZE) {
      return { success: false, error: "File too large. Max 2 MB." };
    }

    const imageKey = buildAvatarKey(userId, avatarFile.name);
    const buffer = Buffer.from(await avatarFile.arrayBuffer());
    await uploadFile({ key: imageKey, body: buffer, contentType: avatarFile.type });
    imageUpdate = { image: imageKey };
  } else if (removeAvatar) {
    imageUpdate = { image: null };
  }

  // Delete old R2 avatar if replacing or removing
  if (imageUpdate.image !== undefined) {
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });
    if (current?.image?.startsWith("avatars/")) {
      await deleteFile(current.image).catch(() => {});
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { name, locale, defaultOfficeId: defaultOfficeId ?? null, ...imageUpdate },
  });

  await setLocaleCookie(locale as Locale);

  revalidatePath("/");
  return { success: true };
}
