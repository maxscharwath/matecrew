import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { getCurrentTimeInTimezone, getDayOfWeek } from "@/lib/date";
import { ITEM_DISPLAY_ORDER, sumStockQty } from "@/lib/items";
import { resolveOffice } from "@/lib/mcp/context";
import { defineTool } from "@/lib/mcp/tool";
import { DAY_NAMES, officeArg } from "@/lib/mcp/schemas";

export function registerCatalogTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_list_items",
      title: "List items and stock",
      description:
        "Every maté variety an office stocks, with current quantity on hand, which one is the default, and the per-can nutrition figures. Inactive items are only included on request.",
      inputSchema: {
        office: officeArg,
        includeInactive: z
          .boolean()
          .optional()
          .describe("Include retired items. Defaults to false."),
      },
      readOnly: true,
      idempotent: true,
    },
    async ({ office, includeInactive }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const items = await prisma.item.findMany({
        where: {
          officeId: scope.officeId,
          ...(includeInactive ? {} : { active: true }),
        },
        orderBy: ITEM_DISPLAY_ORDER,
        select: {
          id: true,
          name: true,
          active: true,
          isDefault: true,
          sortOrder: true,
          volumeMl: true,
          sugarGrams: true,
          caffeineMg: true,
          stock: { select: { currentQty: true } },
        },
      });

      return {
        office: scope.officeName,
        lowStockThreshold: scope.lowStockThreshold,
        items: items.map((i) => {
          const stockQty = sumStockQty(i.stock);
          return {
            id: i.id,
            name: i.name,
            stockQty,
            lowStock: stockQty <= scope.lowStockThreshold,
            isDefault: i.isDefault,
            active: i.active,
            sortOrder: i.sortOrder,
            nutritionPerCan: {
              volumeMl: i.volumeMl,
              sugarGrams: i.sugarGrams,
              caffeineMg: i.caffeineMg,
            },
          };
        }),
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_get_schedule",
      title: "Weekly maté schedule",
      description:
        "The office's recurring maté sessions for the whole week — when each opens, when orders close, and what it is called. Sessions repeat every week; a session's `startTime` is also when the Slack announcement goes out.",
      inputSchema: { office: officeArg },
      readOnly: true,
      idempotent: true,
    },
    async ({ office }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const sessions = await prisma.mateSession.findMany({
        where: { officeId: scope.officeId },
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
        select: {
          id: true,
          dayOfWeek: true,
          startTime: true,
          cutoffTime: true,
          label: true,
        },
      });

      return {
        office: scope.officeName,
        timezone: scope.timezone,
        officeLocalTime: getCurrentTimeInTimezone(scope.timezone),
        officeToday: DAY_NAMES[getDayOfWeek(scope.timezone)],
        sessions: sessions.map((s) => ({
          sessionId: s.id,
          day: DAY_NAMES[s.dayOfWeek],
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          cutoffTime: s.cutoffTime,
          label: s.label,
        })),
        note:
          sessions.length === 0
            ? "No sessions are scheduled. An admin can add them with matecrew_admin_add_session."
            : undefined,
      };
    },
  );
}
