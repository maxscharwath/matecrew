import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { getCurrentTimeInTimezone } from "@/lib/date";
import { trySyncSessionSchedules } from "@/lib/schedule-sync";
import { buildTestMessage, sendSlackMessage } from "@/lib/slack";
import { sendSessionNotifications } from "@/lib/notifications";
import { McpToolError, resolveAdminOffice } from "@/lib/mcp/context";
import { notifyQuietly } from "@/lib/mcp/notify";
import { defineTool } from "@/lib/mcp/tool";
import { officeArg } from "@/lib/mcp/schemas";

export function registerAdminOfficeTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_admin_update_office",
      title: "Update office settings",
      description:
        "Change an office's configuration: display name, timezone, default language, low-stock threshold, or the Slack channel that receives announcements. Only the fields you pass change. Changing the timezone shifts when every session's Slack message fires.",
      inputSchema: {
        office: officeArg,
        name: z.string().min(1).max(100).optional().describe("New office name."),
        timezone: z
          .string()
          .min(1)
          .optional()
          .describe("IANA timezone, e.g. 'Europe/Zurich'."),
        locale: z
          .enum(["en", "fr"])
          .optional()
          .describe("Default language for this office's Slack messages."),
        lowStockThreshold: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Can count at or below which a low-stock Slack alert is sent.",
          ),
        slackChannelId: z
          .string()
          .max(100)
          .optional()
          .describe(
            "Slack channel id (e.g. C0123456789) for daily messages. Pass an empty string to disconnect Slack.",
          ),
        slackChannelLabel: z
          .string()
          .max(100)
          .optional()
          .describe("Human-readable channel name, e.g. '#mate'."),
      },
      idempotent: true,
    },
    async (
      {
        office,
        name,
        timezone,
        locale,
        lowStockThreshold,
        slackChannelId,
        slackChannelLabel,
      },
      { actor },
    ) => {
      const scope = await resolveAdminOffice(actor, office);

      if (timezone !== undefined && !isValidTimezone(timezone)) {
        throw new McpToolError(
          `"${timezone}" is not a recognised IANA timezone. Use a name like 'Europe/Zurich'.`,
        );
      }

      const data = {
        ...(name === undefined ? {} : { name: name.trim() }),
        ...(timezone === undefined ? {} : { timezone }),
        ...(locale === undefined ? {} : { locale }),
        ...(lowStockThreshold === undefined ? {} : { lowStockThreshold }),
        ...(slackChannelId === undefined
          ? {}
          : { slackChannelId: slackChannelId.trim() || null }),
        ...(slackChannelLabel === undefined
          ? {}
          : { slackChannelLabel: slackChannelLabel.trim() || null }),
      };

      if (Object.keys(data).length === 0) {
        throw new McpToolError(
          "Nothing to change — pass at least one setting to update.",
        );
      }

      let updated;
      try {
        updated = await prisma.office.update({
          where: { id: scope.officeId },
          data,
          select: {
            id: true,
            name: true,
            timezone: true,
            locale: true,
            lowStockThreshold: true,
            slackChannelId: true,
            slackChannelLabel: true,
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("Unique constraint failed")
        ) {
          throw new McpToolError(
            `Another office is already called "${name?.trim()}".`,
          );
        }
        throw error;
      }

      // Timezone changes move every session's UTC slot; connecting or clearing
      // the Slack channel changes whether this office is scheduled at all.
      const slackChanged =
        slackChannelId !== undefined &&
        (slackChannelId.trim() || null) !== scope.slackChannelId;
      if ((timezone !== undefined && timezone !== scope.timezone) || slackChanged) {
        await notifyQuietly("schedule-sync", () => trySyncSessionSchedules());
      }

      return {
        ok: true,
        office: {
          ...updated,
          localTime: getCurrentTimeInTimezone(updated.timezone),
        },
        message: `Updated settings for ${updated.name}.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_test_slack",
      title: "Send a Slack test message",
      description:
        "Post a test message to the office's configured Slack channel to confirm the integration works. Fails with a Slack error code if the channel id is wrong or the bot is not in the channel.",
      inputSchema: { office: officeArg },
    },
    async ({ office }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      if (!scope.slackChannelId) {
        throw new McpToolError(
          `${scope.officeName} has no Slack channel configured. Set one with matecrew_admin_update_office.`,
        );
      }

      const { blocks, fallback } = await buildTestMessage(
        scope.officeName,
        scope.locale,
      );
      try {
        await sendSlackMessage(scope.slackChannelId, blocks, fallback);
      } catch (error) {
        throw new McpToolError(
          `Slack rejected the message: ${
            error instanceof Error ? error.message : String(error)
          }. Check the channel id and that the MateCrew bot has been invited to it.`,
        );
      }

      return {
        ok: true,
        channel: scope.slackChannelLabel ?? scope.slackChannelId,
        message: `Test message posted to ${
          scope.slackChannelLabel ?? scope.slackChannelId
        }.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_announce_session",
      title: "Post the session message now",
      description:
        "Post today's maté ordering message to Slack immediately, bypassing the schedule — for when the automatic announcement did not go out or the round is starting early. Skips sessions that were already announced today.",
      inputSchema: { office: officeArg },
    },
    async ({ office }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      if (!scope.slackChannelId) {
        throw new McpToolError(
          `${scope.officeName} has no Slack channel configured, so there is nowhere to post.`,
        );
      }

      const results = await sendSessionNotifications({
        officeId: scope.officeId,
        skipTimeWindow: true,
      });

      if (results.length === 0) {
        return {
          ok: true,
          sent: 0,
          message:
            "No session was announced — either none is scheduled for today, or today's messages have already gone out.",
        };
      }

      const failed = results.filter((r) => !r.ok);
      return {
        ok: failed.length === 0,
        sent: results.filter((r) => r.ok).length,
        failed: failed.map((f) => ({ session: f.session, error: f.error })),
        message:
          failed.length === 0
            ? `Announced ${results.length} session(s) in Slack.`
            : `${failed.length} of ${results.length} announcements failed.`,
      };
    },
  );
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
