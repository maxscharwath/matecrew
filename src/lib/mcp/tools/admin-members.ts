import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { McpToolError, resolveAdminOffice } from "@/lib/mcp/context";
import { defineTool } from "@/lib/mcp/tool";
import { officeArg } from "@/lib/mcp/schemas";

const rolesArg = z
  .array(z.enum(["USER", "ADMIN"]))
  .min(1)
  .describe(
    "Roles to grant. USER can order and see stats; ADMIN can also manage stock, purchases, members, schedule and reimbursements. ADMIN does not imply USER — pass both for an admin who also orders.",
  );

/**
 * Refuses a change that would leave the office with no admin — nobody could
 * then manage stock, purchases or membership without database access.
 */
async function assertNotLastAdmin(
  officeId: string,
  officeName: string,
): Promise<void> {
  const adminCount = await prisma.membership.count({
    where: { officeId, roles: { has: "ADMIN" } },
  });
  if (adminCount <= 1) {
    throw new McpToolError(
      `That would leave ${officeName} with no admin. Give someone else the ADMIN role first.`,
    );
  }
}

export function registerAdminMemberTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_admin_list_members",
      title: "List members and join requests",
      description:
        "Everyone in the office with their roles, plus any pending requests to join that are waiting for a decision.",
      inputSchema: { office: officeArg },
      readOnly: true,
      idempotent: true,
    },
    async ({ office }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);

      const [members, joinRequests] = await Promise.all([
        prisma.membership.findMany({
          where: { officeId: scope.officeId },
          include: {
            user: { select: { id: true, name: true, email: true, locale: true } },
          },
          orderBy: { user: { name: "asc" } },
        }),
        prisma.joinRequest.findMany({
          where: { officeId: scope.officeId, status: "PENDING" },
          include: { user: { select: { name: true, email: true } } },
          orderBy: { createdAt: "asc" },
        }),
      ]);

      return {
        office: scope.officeName,
        memberCount: members.length,
        adminCount: members.filter((m) => m.roles.includes("ADMIN")).length,
        members: members.map((m) => ({
          membershipId: m.id,
          name: m.user.name,
          email: m.user.email,
          roles: m.roles,
          locale: m.user.locale,
          joinedAt: m.createdAt,
        })),
        pendingJoinRequests: joinRequests.map((r) => ({
          joinRequestId: r.id,
          name: r.user.name,
          email: r.user.email,
          requestedAt: r.createdAt,
        })),
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_add_member",
      title: "Add a member",
      description:
        "Add someone who already has a MateCrew account to this office. People without an account must sign up first — this tool cannot create accounts or send invitations.",
      inputSchema: {
        office: officeArg,
        email: z
          .string()
          .describe("Email address of the existing MateCrew account."),
        roles: rolesArg.optional().describe("Defaults to ['USER']."),
      },
      idempotent: true,
    },
    async ({ office, email, roles }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const normalized = email.trim().toLowerCase();

      const user = await prisma.user.findUnique({
        where: { email: normalized },
        select: { id: true, name: true, email: true },
      });
      if (!user) {
        throw new McpToolError(
          `No MateCrew account exists for ${normalized}. They need to sign up first, then they can be added (or they can request access themselves).`,
        );
      }

      const existing = await prisma.membership.findUnique({
        where: {
          userId_officeId: { userId: user.id, officeId: scope.officeId },
        },
        select: { roles: true },
      });
      if (existing) {
        return {
          ok: true,
          status: "already_member",
          name: user.name,
          roles: existing.roles,
          message: `${user.name} is already a member of ${scope.officeName} with roles ${existing.roles.join(", ")}.`,
        };
      }

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          officeId: scope.officeId,
          roles: roles ?? ["USER"],
        },
        select: { id: true, roles: true },
      });

      // A pending request from this person is now moot.
      await prisma.joinRequest.updateMany({
        where: {
          userId: user.id,
          officeId: scope.officeId,
          status: "PENDING",
        },
        data: { status: "APPROVED" },
      });

      return {
        ok: true,
        membershipId: membership.id,
        name: user.name,
        email: user.email,
        roles: membership.roles,
        message: `Added ${user.name} to ${scope.officeName} as ${membership.roles.join(", ")}.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_set_member_roles",
      title: "Change a member's roles",
      description:
        "Replace a member's roles outright — the roles you pass become their full set. Refused if it would remove the office's last admin.",
      inputSchema: {
        office: officeArg,
        email: z.string().describe("Email of the member to change."),
        roles: rolesArg,
      },
      idempotent: true,
    },
    async ({ office, email, roles }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const membership = await requireMembershipByEmail(
        scope.officeId,
        scope.officeName,
        email,
      );

      if (membership.roles.includes("ADMIN") && !roles.includes("ADMIN")) {
        await assertNotLastAdmin(scope.officeId, scope.officeName);
      }

      await prisma.membership.update({
        where: { id: membership.id },
        data: { roles },
      });

      return {
        ok: true,
        name: membership.user.name,
        previousRoles: membership.roles,
        roles,
        message: `${membership.user.name} is now ${roles.join(", ")} in ${scope.officeName}.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_remove_member",
      title: "Remove a member",
      description:
        "Remove someone from the office. Their consumption history and reimbursement lines are kept, so past months still balance — they simply can no longer order. Refused if it would remove the last admin.",
      inputSchema: {
        office: officeArg,
        email: z.string().describe("Email of the member to remove."),
      },
      destructive: true,
      idempotent: true,
    },
    async ({ office, email }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const membership = await requireMembershipByEmail(
        scope.officeId,
        scope.officeName,
        email,
      );

      if (membership.roles.includes("ADMIN")) {
        await assertNotLastAdmin(scope.officeId, scope.officeName);
      }

      await prisma.$transaction([
        prisma.membership.delete({ where: { id: membership.id } }),
        // Otherwise their default office would point somewhere they can't reach.
        prisma.user.updateMany({
          where: { id: membership.userId, defaultOfficeId: scope.officeId },
          data: { defaultOfficeId: null },
        }),
      ]);

      return {
        ok: true,
        name: membership.user.name,
        message: `Removed ${membership.user.name} from ${scope.officeName}. Their history is preserved.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_review_join_request",
      title: "Approve or reject a join request",
      description:
        "Decide on a pending request to join the office. Approving creates the membership with the USER role.",
      inputSchema: {
        office: officeArg,
        joinRequestId: z
          .string()
          .describe("Join request id from matecrew_admin_list_members."),
        decision: z
          .enum(["approve", "reject"])
          .describe("What to do with the request."),
      },
      idempotent: true,
    },
    async ({ office, joinRequestId, decision }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);

      const request = await prisma.joinRequest.findUnique({
        where: { id: joinRequestId },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      if (!request || request.officeId !== scope.officeId) {
        throw new McpToolError(
          `No join request with id ${joinRequestId} in ${scope.officeName}.`,
        );
      }
      if (request.status !== "PENDING") {
        return {
          ok: true,
          status: `already_${request.status.toLowerCase()}`,
          message: `That request was already ${request.status.toLowerCase()}.`,
        };
      }

      if (decision === "reject") {
        await prisma.joinRequest.update({
          where: { id: joinRequestId },
          data: { status: "REJECTED" },
        });
        return {
          ok: true,
          decision: "rejected",
          name: request.user.name,
          message: `Rejected ${request.user.name}'s request to join ${scope.officeName}.`,
        };
      }

      await prisma.$transaction([
        prisma.membership.create({
          data: {
            userId: request.userId,
            officeId: scope.officeId,
            roles: ["USER"],
          },
        }),
        prisma.joinRequest.update({
          where: { id: joinRequestId },
          data: { status: "APPROVED" },
        }),
      ]);

      return {
        ok: true,
        decision: "approved",
        name: request.user.name,
        email: request.user.email,
        message: `${request.user.name} can now order maté in ${scope.officeName}.`,
      };
    },
  );
}

async function requireMembershipByEmail(
  officeId: string,
  officeName: string,
  email: string,
) {
  const membership = await prisma.membership.findFirst({
    where: {
      officeId,
      user: { email: { equals: email.trim(), mode: "insensitive" } },
    },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!membership) {
    throw new McpToolError(
      `${email} is not a member of ${officeName}. Call matecrew_admin_list_members to see who is.`,
    );
  }
  return membership;
}
