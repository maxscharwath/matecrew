import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/client";

/**
 * Get the current session or redirect to sign-in.
 * Use in Server Components and Server Actions.
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
 * Get the current session + user with roles, or redirect to sign-in.
 */
export async function requireUser() {
  const session = await requireSession();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { office: { select: { id: true, name: true } } },
  });

  if (!user) {
    redirect("/sign-in");
  }

  return { session, user };
}

/**
 * Require the current user to have at least one of the given roles.
 * Redirects to /dashboard if unauthorized.
 */
export async function requireRoles(...requiredRoles: Role[]) {
  const { session, user } = await requireUser();

  const hasRole = requiredRoles.some((role) => user.roles.includes(role));

  if (!hasRole) {
    redirect("/dashboard");
  }

  return { session, user };
}

/**
 * Check if a user has a specific role.
 */
export function hasRole(userRoles: Role[], role: Role): boolean {
  return userRoles.includes(role);
}

/**
 * Check if a user has any of the given roles.
 */
export function hasAnyRole(userRoles: Role[], ...roles: Role[]): boolean {
  return roles.some((role) => userRoles.includes(role));
}

/**
 * Get the current session without redirecting. Returns null if not authenticated.
 * Use when auth is optional (e.g. public pages with optional personalization).
 */
export async function getOptionalSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session;
}
