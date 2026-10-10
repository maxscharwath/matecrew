import type { Prisma, Role } from "@/generated/prisma/client";
import { expectRows, type BatchClient, type BatchStep } from "@/platform";

/**
 * A member's roles in an office, stored as one `MembershipRole` row per role
 * (no scalar lists: the schema stays portable). Code works with `Role[]`;
 * these helpers translate at the query boundary.
 */

/** Include/select fragment that loads a membership's roles; turn them into `Role[]` with `roleList`. */
export const rolesSelect = {
  roles: { select: { role: true }, orderBy: { role: "asc" } },
} as const satisfies Prisma.MembershipSelect;

/** The roles of a membership loaded with `rolesSelect`. */
export function roleList(membership: { readonly roles: readonly { readonly role: Role }[] }): Role[] {
  return membership.roles.map((row) => row.role);
}

/** The membership with `roles` as a plain `Role[]`, for code that reads `membership.roles.includes(...)`. */
export function withRoleList<T extends { readonly roles: readonly { readonly role: Role }[] }>(
  membership: T,
): Omit<T, "roles"> & { roles: Role[] } {
  return { ...membership, roles: roleList(membership) };
}

/** `where` fragment for memberships that hold `role`. */
export function hasRoleWhere(role: Role) {
  return { roles: { some: { role } } } satisfies Prisma.MembershipWhereInput;
}

/** Batch writes that create a membership (with a known id) and its roles. */
export function createMembershipWrites(
  db: BatchClient,
  membership: { readonly id: string; readonly userId: string; readonly officeId: string; readonly roles: readonly Role[] },
) {
  const { roles, ...row } = membership;
  return [
    db.membership.createMany({ data: [row] }),
    db.membershipRole.createMany({ data: roles.map((role) => ({ membershipId: row.id, role })) }),
  ];
}

/** Batch writes that replace a membership's roles with `roles`. */
export function replaceRolesWrites(db: BatchClient, membershipId: string, roles: readonly Role[]) {
  return [
    db.membershipRole.deleteMany({ where: { membershipId } }),
    db.membershipRole.createMany({ data: roles.map((role) => ({ membershipId, role })) }),
  ];
}

/**
 * Batch guard against an office left without an admin. A no-op update of the
 * office row that only matches while the office still has an admin; put it
 * after the batch's role changes or removals, so it sees their result. When
 * they would remove the last admin, including through another admin demoted
 * at the same time, it touches no row and the whole batch is rolled back with
 * `BatchConflictError("guard")`. Plain SQL that SQLite and Postgres both run.
 */
export function officeKeepsAnAdmin(db: BatchClient, officeId: string): BatchStep {
  return expectRows(
    db.$executeRaw`UPDATE "Office" SET "lowStockThreshold" = "lowStockThreshold"
      WHERE "id" = ${officeId}
        AND EXISTS (
          SELECT 1 FROM "Membership" m
          JOIN "MembershipRole" r ON r."membershipId" = m."id"
          WHERE m."officeId" = ${officeId} AND r."role" = 'ADMIN'
        )`,
    1,
  );
}
