"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BatchConflictError, commitBatch, expectRows, newId, prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import {
  createMembershipWrites,
  officeKeepsAnAdmin,
  replaceRolesWrites,
  roleList,
  rolesSelect,
} from "@/lib/membership-roles";
import { getTranslations } from "next-intl/server";

type ActionResult = { success: true } | { success: false; error: string };

export async function approveJoinRequest(
  officeId: string,
  joinRequestId: string
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const request = await prisma.joinRequest.findUnique({
    where: { id: joinRequestId },
  });

  if (!request || request.officeId !== officeId) {
    return { success: false, error: t("errors.joinRequestNotFound") };
  }

  if (request.status !== "PENDING") {
    return { success: false, error: t("errors.joinRequestAlreadyHandled") };
  }

  // Read above, then one atomic batch: the approval, the membership and its
  // role. The approval is guarded on the request still being PENDING, so two
  // admins approving at once roll the second batch back instead of failing
  // halfway through it.
  try {
    await commitBatch((db) => [
      expectRows(
        db.joinRequest.updateMany({
          where: { id: joinRequestId, status: "PENDING" },
          data: { status: "APPROVED" },
        }),
        1,
      ),
      ...createMembershipWrites(db, { id: newId(), userId: request.userId, officeId, roles: ["USER"] }),
    ]);
  } catch (e) {
    if (!(e instanceof BatchConflictError)) throw e;
    const error = e.reason === "unique" ? "errors.alreadyMember" : "errors.joinRequestAlreadyHandled";
    return { success: false, error: t(error) };
  }

  revalidatePath(`/org/${officeId}/admin/members`);
  return { success: true };
}

export async function rejectJoinRequest(
  officeId: string,
  joinRequestId: string
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const request = await prisma.joinRequest.findUnique({
    where: { id: joinRequestId },
  });

  if (!request || request.officeId !== officeId) {
    return { success: false, error: t("errors.joinRequestNotFound") };
  }

  if (request.status !== "PENDING") {
    return { success: false, error: t("errors.joinRequestAlreadyHandled") };
  }

  await prisma.joinRequest.update({
    where: { id: joinRequestId },
    data: { status: "REJECTED" },
  });

  revalidatePath(`/org/${officeId}/admin/members`);
  return { success: true };
}

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

  // The membership and its roles land together, or not at all.
  try {
    await commitBatch((db) =>
      createMembershipWrites(db, { id: newId(), userId: user.id, officeId, roles: parsed.data.roles }),
    );
  } catch (e) {
    if (e instanceof BatchConflictError && e.reason === "unique") {
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
    include: rolesSelect,
  });

  if (!membership || membership.officeId !== officeId) {
    return { success: false, error: t("errors.officeNotFound") };
  }

  // Read above, then one atomic batch that swaps the roles. Dropping ADMIN is
  // guarded on the office still having an admin afterwards (last admin
  // protection), which also holds when another admin is demoted concurrently.
  const demotesAdmin = roleList(membership).includes("ADMIN") && !parsed.data.includes("ADMIN");
  try {
    await commitBatch((db) => [
      ...replaceRolesWrites(db, membershipId, parsed.data),
      ...(demotesAdmin ? [officeKeepsAnAdmin(db, officeId)] : []),
    ]);
  } catch (e) {
    if (e instanceof BatchConflictError && e.reason === "guard") {
      return { success: false, error: t("errors.cannotRemoveLastAdmin") };
    }
    throw e;
  }

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
    include: rolesSelect,
  });

  if (!membership || membership.officeId !== officeId) {
    return { success: false, error: t("errors.officeNotFound") };
  }

  // Read above, then one atomic batch: the membership (its roles cascade) and
  // the member's default office. Removing an admin is guarded on the office
  // still having one afterwards (last admin protection).
  const isAdmin = roleList(membership).includes("ADMIN");
  try {
    await commitBatch((db) => [
      db.membership.deleteMany({ where: { id: membershipId } }),
      db.user.updateMany({
        where: { id: membership.userId, defaultOfficeId: officeId },
        data: { defaultOfficeId: null },
      }),
      ...(isAdmin ? [officeKeepsAnAdmin(db, officeId)] : []),
    ]);
  } catch (e) {
    if (e instanceof BatchConflictError && e.reason === "guard") {
      return { success: false, error: t("errors.cannotRemoveLastAdmin") };
    }
    throw e;
  }

  revalidatePath(`/org/${officeId}/admin/members`);
  return { success: true };
}
