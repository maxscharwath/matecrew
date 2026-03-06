import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/client";

// Cached internal helpers — deduplicated within a single React request
const getSessionInternal = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

const getMembershipInternal = cache(async (userId: string, officeId: string) => {
  return prisma.membership.findUnique({
    where: { userId_officeId: { userId, officeId } },
    include: {
      user: true,
      office: { select: { id: true, name: true, lowStockThreshold: true } },
    },
  });
});

/**
 * Get the current session or redirect to sign-in.
 */
export async function requireSession() {
  const session = await getSessionInternal();
  if (!session) redirect("/sign-in");
  return session;
}

/**
 * Get the current session without redirecting.
 */
export async function getOptionalSession() {
  return getSessionInternal();
}

/**
 * Require the user has a membership for the given office.
 * Redirects to /sign-in if no session, / if no membership.
 */
export async function requireMembership(officeId: string) {
  const session = await requireSession();
  const membership = await getMembershipInternal(session.user.id, officeId);
  if (!membership) redirect("/");
  return { session, membership };
}

/**
 * Require the user has a membership with at least one of the given roles.
 * Redirects to /org/[officeId]/dashboard if unauthorized.
 */
export async function requireOrgRoles(officeId: string, ...requiredRoles: Role[]) {
  const { session, membership } = await requireMembership(officeId);
  const hasRole = requiredRoles.some((role) => membership.roles.includes(role));
  if (!hasRole) redirect(`/org/${officeId}/dashboard`);
  return { session, membership };
}

/**
 * Check membership without redirecting — returns null if no membership.
 */
export async function getOptionalMembership(officeId: string) {
  const session = await requireSession();
  const membership = await getMembershipInternal(session.user.id, officeId);
  return { session, membership };
}

/**
 * Get all memberships for a user (for the org switcher).
 */
export const getUserMemberships = cache(async (userId: string) => {
  return prisma.membership.findMany({
    where: { userId },
    include: {
      office: { select: { id: true, name: true } },
    },
    orderBy: { office: { name: "asc" } },
  });
});
