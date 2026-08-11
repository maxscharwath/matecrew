import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { toISODateString } from "@/lib/date";
import { ITEM_DISPLAY_ORDER } from "@/lib/items";
import { predictReorder } from "@/lib/stock-prediction";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { stockDeltaOps } from "@/lib/stock";
import { McpToolError, resolveAdminOffice } from "@/lib/mcp/context";
import { notifyQuietly } from "@/lib/mcp/notify";
import { defineTool } from "@/lib/mcp/tool";
import { officeArg } from "@/lib/mcp/schemas";

const PREDICTION_WINDOW_DAYS = 60;

export function registerAdminStockTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_admin_stock_report",
      title: "Stock report and reorder forecast",
      description:
        "Admin view of stock: quantity on hand per item, which items are below the low-stock threshold, recent movements, and a per-item forecast of when stock will hit the threshold (based on an exponentially-weighted average of the last 60 days). Use this to decide whether to place an order.",
      inputSchema: {
        office: officeArg,
        movementLimit: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe(
            "How many recent stock movements to include per item. Defaults to 5; 0 omits them.",
          ),
      },
      readOnly: true,
      idempotent: true,
    },
    async ({ office, movementLimit }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const windowStart = new Date(
        Date.now() - PREDICTION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );

      const [items, movements] = await Promise.all([
        prisma.item.findMany({
          where: { officeId: scope.officeId, active: true },
          orderBy: ITEM_DISPLAY_ORDER,
          select: {
            id: true,
            name: true,
            stock: { select: { currentQty: true } },
          },
        }),
        prisma.stockMovement.findMany({
          where: {
            officeId: scope.officeId,
            createdAt: { gte: windowStart },
          },
          orderBy: { createdAt: "asc" },
          select: {
            itemId: true,
            delta: true,
            reason: true,
            note: true,
            createdAt: true,
            user: { select: { name: true } },
          },
        }),
      ]);

      const perItemLimit = movementLimit ?? 5;

      const report = items.map((item) => {
        const itemMovements = movements.filter((m) => m.itemId === item.id);
        const currentQty = item.stock.reduce((sum, s) => sum + s.currentQty, 0);
        // Per-item forecast: only this item's own movements drive its rate.
        const prediction = predictReorder(
          currentQty,
          scope.lowStockThreshold,
          itemMovements,
        );

        return {
          itemId: item.id,
          item: item.name,
          currentQty,
          lowStock: currentQty <= scope.lowStockThreshold,
          forecast: {
            avgCansPerDay: round2(prediction.avgDailyConsumption),
            daysUntilThreshold:
              prediction.daysUntilThreshold === null
                ? null
                : Math.round(prediction.daysUntilThreshold),
            reorderBy: prediction.predictedDepletionDate
              ? toISODateString(prediction.predictedDepletionDate)
              : null,
            confidence: prediction.confidence,
            daysWithData: prediction.dataPointDays,
          },
          recentMovements:
            perItemLimit === 0
              ? undefined
              : itemMovements
                  .slice(-perItemLimit)
                  .reverse()
                  .map((m) => ({
                    delta: m.delta,
                    reason: m.reason,
                    note: m.note,
                    by: m.user?.name ?? null,
                    at: m.createdAt,
                  })),
        };
      });

      return {
        office: scope.officeName,
        lowStockThreshold: scope.lowStockThreshold,
        totalCans: report.reduce((sum, r) => sum + r.currentQty, 0),
        itemsBelowThreshold: report
          .filter((r) => r.lowStock)
          .map((r) => r.item),
        items: report,
        forecastNote:
          "A 'insufficient' or 'low' confidence forecast means there were too few days of consumption data to trust the date.",
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_adjust_stock",
      title: "Correct a stock count",
      description:
        "Apply a manual correction to an item's stock — for a physical recount, breakage or a can taken without being recorded. Positive adds, negative removes. This does NOT record anyone's consumption and does not affect reimbursements; use matecrew_admin_record_consumption for that, or matecrew_admin_mark_delivered for an arriving order.",
      inputSchema: {
        office: officeArg,
        item: z.string().describe("Item id or name to adjust."),
        adjustment: z
          .number()
          .int()
          .describe(
            "Signed change in cans, e.g. 12 to add twelve, -3 to remove three. Cannot be zero, and cannot take stock below zero.",
          ),
        note: z
          .string()
          .max(200)
          .optional()
          .describe("Why the correction was made — shown in the stock history."),
      },
    },
    async ({ office, item, adjustment, note }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);

      if (adjustment === 0) {
        throw new McpToolError("An adjustment of zero would change nothing.");
      }

      const target = await prisma.item.findFirst({
        where: {
          officeId: scope.officeId,
          OR: [
            { id: item.trim() },
            { name: { equals: item.trim(), mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true },
      });
      if (!target) {
        throw new McpToolError(
          `No item called "${item}" in ${scope.officeName}. Call matecrew_list_items to see them.`,
        );
      }

      const stock = await prisma.stock.findUnique({
        where: { officeId_itemId: { officeId: scope.officeId, itemId: target.id } },
        select: { currentQty: true },
      });
      const currentQty = stock?.currentQty ?? 0;
      const newQty = currentQty + adjustment;
      if (newQty < 0) {
        throw new McpToolError(
          `That would take ${target.name} to ${newQty}. Only ${currentQty} are in stock.`,
        );
      }

      await prisma.$transaction(
        stockDeltaOps({
          officeId: scope.officeId,
          itemId: target.id,
          delta: adjustment,
          reason: "ADJUSTMENT",
          note: note || null,
          userId: actor.userId,
        }),
      );

      await notifyQuietly("low-stock", () =>
        checkAndAlertLowStock(scope.officeId, target.id),
      );

      return {
        ok: true,
        item: target.name,
        previousQty: currentQty,
        newQty,
        lowStock: newQty <= scope.lowStockThreshold,
        message: `${target.name}: ${currentQty} → ${newQty} cans.`,
      };
    },
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
