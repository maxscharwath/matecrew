import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { getCurrentTimeInTimezone, getTodayDate, toISODateString } from "@/lib/date";
import { notifyAdminsOfJoinRequest } from "@/lib/notify-join-request";
import { listMemberships, McpToolError, resolveOffice } from "@/lib/mcp/context";
import { defineTool } from "@/lib/mcp/tool";
import { officeArg } from "@/lib/mcp/schemas";

export function registerAccountTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_whoami",
      title: "Who am I",
      description:
        "Identify the signed-in MateCrew user and list the offices they belong to, with their roles in each. Call this first when you do not yet know which office to act on, or when a tool reports an ambiguous office.",
      inputSchema: {},
      readOnly: true,
      idempotent: true,
    },
    async (_args, { actor }) => {
      const memberships = await listMemberships(actor);
      const today = getTodayDate();
      return {
        user: {
          name: actor.name,
          email: actor.email,
          locale: actor.locale,
        },
        today: toISODateString(today),
        offices: memberships,
        defaultOffice:
          memberships.find((m) => m.isDefault)?.officeName ??
          (memberships.length === 1 ? memberships[0].officeName : null),
        hint:
          memberships.length === 0
            ? "This user belongs to no office yet — they need to be added by an admin before any other tool will work."
            : undefined,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_get_office",
      title: "Get office details",
      description:
        "Read one office's configuration and current local time: timezone, locale, low-stock threshold, whether Slack is wired up, member count, and the caller's roles.",
      inputSchema: { office: officeArg },
      readOnly: true,
      idempotent: true,
    },
    async ({ office }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const [memberCount, itemCount] = await Promise.all([
        prisma.membership.count({ where: { officeId: scope.officeId } }),
        prisma.item.count({ where: { officeId: scope.officeId, active: true } }),
      ]);
      return {
        officeId: scope.officeId,
        name: scope.officeName,
        timezone: scope.timezone,
        localTime: getCurrentTimeInTimezone(scope.timezone),
        locale: scope.locale,
        lowStockThreshold: scope.lowStockThreshold,
        slackConnected: scope.slackChannelId !== null,
        memberCount,
        activeItemCount: itemCount,
        yourRoles: scope.roles,
        youAreAdmin: scope.isAdmin,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_set_default_office",
      title: "Set default office",
      description:
        "Choose which office MateCrew uses when a tool call omits the office. Only useful for users who belong to more than one office.",
      inputSchema: {
        office: z
          .string()
          .describe("Office id or office name to make the default."),
      },
      idempotent: true,
    },
    async ({ office }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      await prisma.user.update({
        where: { id: actor.userId },
        data: { defaultOfficeId: scope.officeId },
      });
      return {
        ok: true,
        defaultOffice: scope.officeName,
        message: `${scope.officeName} is now your default office.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_set_locale",
      title: "Set language",
      description:
        "Set the language MateCrew uses for this user in the web app, emails and Slack messages.",
      inputSchema: {
        locale: z
          .enum(["en", "fr"])
          .describe("Language code: 'en' for English, 'fr' for French."),
      },
      idempotent: true,
    },
    async ({ locale }, { actor }) => {
      await prisma.user.update({
        where: { id: actor.userId },
        data: { locale },
      });
      return { ok: true, locale };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_request_office_access",
      title: "Request office access",
      description:
        "Ask to join an office you are not a member of. Admins of that office review the request. Use matecrew_whoami first — if the office is already listed there, you are already a member.",
      inputSchema: {
        officeName: z.string().describe("Exact name of the office to join."),
      },
      idempotent: true,
    },
    async ({ officeName }, { actor }) => {
      const office = await prisma.office.findFirst({
        where: { name: { equals: officeName.trim(), mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (!office) {
        throw new McpToolError(
          `No office named "${officeName}" exists. Office names must match exactly — ask a colleague for the exact name.`,
        );
      }

      const existingMembership = await prisma.membership.findUnique({
        where: {
          userId_officeId: { userId: actor.userId, officeId: office.id },
        },
        select: { id: true },
      });
      if (existingMembership) {
        return {
          ok: true,
          status: "ALREADY_MEMBER",
          office: office.name,
          message: `You are already a member of ${office.name}.`,
        };
      }

      const existingRequest = await prisma.joinRequest.findUnique({
        where: {
          userId_officeId: { userId: actor.userId, officeId: office.id },
        },
        select: { status: true },
      });
      if (existingRequest?.status === "PENDING") {
        return {
          ok: true,
          status: "ALREADY_PENDING",
          office: office.name,
          message: `Your request to join ${office.name} is already waiting for an admin.`,
        };
      }

      // Re-requesting after a rejection is allowed — the row is reused so the
      // unique (user, office) constraint still holds.
      await prisma.joinRequest.upsert({
        where: {
          userId_officeId: { userId: actor.userId, officeId: office.id },
        },
        create: { userId: actor.userId, officeId: office.id },
        update: { status: "PENDING", createdAt: new Date() },
      });

      // Awaited rather than fire-and-forget: this runs in a serverless handler
      // that may freeze the moment the response is written. The notifier
      // swallows its own failures, so awaiting cannot fail the request.
      await notifyAdminsOfJoinRequest({
        officeId: office.id,
        requesterUserId: actor.userId,
      });

      return {
        ok: true,
        status: "PENDING",
        office: office.name,
        message: `Requested access to ${office.name}. An admin has to approve it.`,
      };
    },
  );
}
