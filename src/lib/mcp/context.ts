import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/client";

/**
 * Authorization for MCP callers.
 *
 * An MCP access token is minted for one MateCrew user, so a tool call carries
 * exactly that user's authority — never more. Roles are per-office
 * (`Membership.roles`), so "am I an admin" is only ever answered against a
 * resolved office, and every tool that touches office data goes through
 * `resolveOffice` first. OAuth scopes deliberately play no part: the app's
 * own membership rows are the single source of truth, the same ones the web UI
 * and Slack handlers use.
 */

/** An error whose message is safe to show the model and the end user. */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

export interface McpActor {
  userId: string;
  name: string;
  email: string;
  locale: string;
  defaultOfficeId: string | null;
}

export interface OfficeScope {
  officeId: string;
  officeName: string;
  timezone: string;
  locale: string;
  lowStockThreshold: number;
  slackChannelId: string | null;
  slackChannelLabel: string | null;
  roles: Role[];
  isAdmin: boolean;
}

/**
 * The MateCrew user id carried by the verified access token. `/api/mcp` rejects
 * unauthenticated calls before any tool runs, so a missing id means the token
 * verifier and this helper disagree — a bug, not a user-facing condition.
 */
export function actorIdFromAuth(
  authInfo: { extra?: Record<string, unknown> } | undefined,
): string {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new McpToolError(
      "This request is not associated with a MateCrew account. Reconnect the MateCrew connector and try again.",
    );
  }
  return userId;
}

export async function loadActor(userId: string): Promise<McpActor> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      locale: true,
      defaultOfficeId: true,
    },
  });
  if (!user) {
    // The account was deleted while a token was still live.
    throw new McpToolError("This MateCrew account no longer exists.");
  }
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    locale: user.locale,
    defaultOfficeId: user.defaultOfficeId,
  };
}

export interface MembershipSummary {
  officeId: string;
  officeName: string;
  roles: Role[];
  isAdmin: boolean;
  isDefault: boolean;
}

export async function listMemberships(
  actor: McpActor,
): Promise<MembershipSummary[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId: actor.userId },
    select: {
      roles: true,
      office: { select: { id: true, name: true } },
    },
    orderBy: { office: { name: "asc" } },
  });
  return memberships.map((m) => ({
    officeId: m.office.id,
    officeName: m.office.name,
    roles: m.roles,
    isAdmin: m.roles.includes("ADMIN"),
    isDefault: m.office.id === actor.defaultOfficeId,
  }));
}

/**
 * Resolves the office a tool should act on and the caller's roles in it.
 *
 * `office` accepts an id or a name — a model driving this server usually knows
 * the office by the name a human said, not by its cuid. When omitted, the
 * caller's default office is used, or their only office if they have exactly
 * one; anything more ambiguous is an error that lists the choices so the model
 * can ask or retry with one.
 */
export async function resolveOffice(
  actor: McpActor,
  office?: string | null,
): Promise<OfficeScope> {
  const memberships = await prisma.membership.findMany({
    where: { userId: actor.userId },
    select: {
      roles: true,
      office: {
        select: {
          id: true,
          name: true,
          timezone: true,
          locale: true,
          lowStockThreshold: true,
          slackChannelId: true,
          slackChannelLabel: true,
        },
      },
    },
    orderBy: { office: { name: "asc" } },
  });

  if (memberships.length === 0) {
    throw new McpToolError(
      "You are not a member of any office yet. Ask an office admin to add you, or request access in the MateCrew web app first.",
    );
  }

  const wanted = office?.trim();
  let match: (typeof memberships)[number] | undefined;

  if (wanted) {
    match =
      memberships.find((m) => m.office.id === wanted) ??
      memberships.find(
        (m) => m.office.name.toLowerCase() === wanted.toLowerCase(),
      );
    if (!match) {
      throw new McpToolError(
        `You have no access to an office called "${wanted}". Your offices: ${memberships
          .map((m) => m.office.name)
          .join(", ")}.`,
      );
    }
  } else if (memberships.length === 1) {
    match = memberships[0];
  } else {
    match = memberships.find((m) => m.office.id === actor.defaultOfficeId);
    if (!match) {
      throw new McpToolError(
        `You belong to several offices and have no default set. Pass one of: ${memberships
          .map((m) => m.office.name)
          .join(", ")}.`,
      );
    }
  }

  return {
    officeId: match.office.id,
    officeName: match.office.name,
    timezone: match.office.timezone,
    locale: match.office.locale,
    lowStockThreshold: match.office.lowStockThreshold,
    slackChannelId: match.office.slackChannelId,
    slackChannelLabel: match.office.slackChannelLabel,
    roles: match.roles,
    isAdmin: match.roles.includes("ADMIN"),
  };
}

/** Same as `resolveOffice`, but refuses non-admins. */
export async function resolveAdminOffice(
  actor: McpActor,
  office?: string | null,
): Promise<OfficeScope> {
  const scope = await resolveOffice(actor, office);
  if (!scope.isAdmin) {
    throw new McpToolError(
      `You are not an admin of ${scope.officeName}, so you cannot perform this action.`,
    );
  }
  return scope;
}
