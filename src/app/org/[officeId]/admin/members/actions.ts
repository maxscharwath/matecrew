"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getTranslations } from "next-intl/server";

type ActionResult = { success: true } | { success: false; error: string };

export async function addMember(
  officeId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const roles = formData.getAll("roles") as string[];

  const AddMemberSchema = z.object({
    email: z.string().email(t("errors.invalidEmail")),
    roles: z
      .array(z.enum(["USER", "ADMIN"]))
      .min(1, t("errors.atLeastOneRole")),
  });

  const parsed = AddMemberSchema.safeParse({
    email: formData.get("email"),
    roles,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });

  if (!user) {
    return { success: false, error: t("errors.userNotFound") };
  }

  try {
    await prisma.membership.create({
      data: {
        userId: user.id,
        officeId,
        roles: parsed.data.roles,
      },
    });
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.includes("Unique constraint failed")
    ) {
      return { success: false, error: t("errors.alreadyMember") };
    }
    throw e;
  }

  revalidatePath(`/org/${officeId}/admin/members`);
  return { success: true };
}

export async function updateMemberRoles(
  officeId: string,
  membershipId: string,
  roles: string[]
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const RolesSchema = z
    .array(z.enum(["USER", "ADMIN"]))
    .min(1, t("errors.atLeastOneRole"));

  const parsed = RolesSchema.safeParse(roles);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
  });

  if (!membership || membership.officeId !== officeId) {
    return { success: false, error: t("errors.officeNotFound") };
  }

  // Last admin protection: if removing ADMIN role, ensure another admin exists
  if (
    membership.roles.includes("ADMIN") &&
    !parsed.data.includes("ADMIN")
  ) {
    const adminCount = await prisma.membership.count({
      where: { officeId, roles: { has: "ADMIN" } },
    });
    if (adminCount <= 1) {
      return { success: false, error: t("errors.cannotRemoveLastAdmin") };
    }
  }

  await prisma.membership.update({
    where: { id: membershipId },
    data: { roles: parsed.data },
  });

  revalidatePath(`/org/${officeId}/admin/members`);
  return { success: true };
}

export async function removeMember(
  officeId: string,
  membershipId: string
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
  });

  if (!membership || membership.officeId !== officeId) {
    return { success: false, error: t("errors.officeNotFound") };
  }

  // Last admin protection
  if (membership.roles.includes("ADMIN")) {
    const adminCount = await prisma.membership.count({
      where: { officeId, roles: { has: "ADMIN" } },
    });
    if (adminCount <= 1) {
      return { success: false, error: t("errors.cannotRemoveLastAdmin") };
    }
  }

  await prisma.$transaction([
    prisma.membership.delete({ where: { id: membershipId } }),
    prisma.user.updateMany({
      where: { id: membership.userId, defaultOfficeId: officeId },
      data: { defaultOfficeId: null },
    }),
  ]);

  revalidatePath(`/org/${officeId}/admin/members`);
  return { success: true };
}
