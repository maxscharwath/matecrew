import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/client";

/**
 * Get the current session or redirect to sign-in.
 */
export async function requireSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  return session;
}

/**
 * Get the current session without redirecting.
 */
export async function getOptionalSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session;
}

/**
 * Require the user has a membership for the given office.
 * Redirects to /sign-in if no session, / if no membership.
 */
export async function requireMembership(officeId: string) {
  const session = await requireSession();

  const membership = await prisma.membership.findUnique({
    where: {
      userId_officeId: { userId: session.user.id, officeId },
    },
    include: {
      user: true,
      office: { select: { id: true, name: true } },
    },
  });

  if (!membership) {
    redirect("/");
  }

  return { session, membership };
}

/**
 * Require the user has a membership with at least one of the given roles.
 * Redirects to /org/[officeId]/dashboard if unauthorized.
 */
export async function requireOrgRoles(officeId: string, ...requiredRoles: Role[]) {
  const { session, membership } = await requireMembership(officeId);

  const hasRole = requiredRoles.some((role) => membership.roles.includes(role));

  if (!hasRole) {
    redirect(`/org/${officeId}/dashboard`);
  }

  return { session, membership };
}

/**
 * Get all memberships for a user (for the org switcher).
 */
export async function getUserMemberships(userId: string) {
  return prisma.membership.findMany({
    where: { userId },
    include: {
      office: { select: { id: true, name: true } },
    },
    orderBy: { office: { name: "asc" } },
  });
}
