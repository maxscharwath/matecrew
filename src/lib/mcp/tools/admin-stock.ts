import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { toISODateString } from "@/lib/date";
import { ITEM_DISPLAY_ORDER, resolveItemRefs, sumStockQty } from "@/lib/items";
import { roundCents } from "@/lib/money";
import { predictReorder } from "@/lib/stock-prediction";
import {
  checkAndAlertLowStock,
  checkAndAlertLowStockMany,
} from "@/lib/stock-alerts";
import { stockDeltaOps } from "@/lib/stock";
import { recordStockCount } from "@/lib/stock-count";
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
        const currentQty = sumStockQty(item.stock);
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
            avgCansPerDay: roundCents(prediction.avgDailyConsumption),
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
      title: "Correct a stock number",
      description:
        "Apply a manual correction to an item's stock — a bookkeeping repair such as a mistyped delivery. Positive adds, negative removes. This is free: it records nobody's consumption and moves no money. To reconcile against a physical count, use matecrew_admin_record_stock_count instead, which bills the missing cans; for an arriving order use matecrew_admin_mark_delivered.",
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

  defineTool(
    server,
    {
      name: "matecrew_admin_record_stock_count",
      title: "Record a physical stock count",
      description:
        "Record what is actually in the fridge, item by item, and reconcile it against what the app believes. The gap is the office's shrinkage: missing cans are billed to the people who drank during the period that contains today, in proportion to how much they drank, so the person who paid for the order is reimbursed in full. Counting is the only way MateCrew can detect cans taken without being recorded — confirm the numbers with the user before calling this, as it moves money.",
      inputSchema: {
        office: officeArg,
        counts: z
          .array(
            z.object({
              item: z.string().describe("Item id or name."),
              countedQty: z
                .number()
                .int()
                .min(0)
                .max(10_000)
                .describe("Cans actually on the shelf."),
            }),
          )
          .min(1)
          .describe(
            "One entry per item counted. Items left out are not touched — omit an item rather than guessing its count.",
          ),
        note: z
          .string()
          .max(200)
          .optional()
          .describe("Context for the count, shown in the inventory history."),
      },
    },
    async ({ office, counts, note }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);

      const { idByRef, names } = await resolveItemRefs(
        scope.officeId,
        counts.map((c) => c.item),
      );

      const resolved = counts.map((c) => {
        const itemId = idByRef.get(c.item);
        if (!itemId) {
          throw new McpToolError(
            `No item called "${c.item}" in ${scope.officeName}. Existing items: ${names.join(", ") || "none"}.`,
          );
        }
        return { itemId, countedQty: c.countedQty };
      });

      const outcome = await recordStockCount({
        officeId: scope.officeId,
        userId: actor.userId,
        counts: resolved,
        note: note || null,
      });

      if (!outcome.ok) {
        throw new McpToolError(
          outcome.reason === "duplicate_item"
            ? "An item is counted twice. List each item once."
            : `No item called "${outcome.itemId}" in ${scope.officeName}.`,
        );
      }

      const { lines, gaps, missing, surplus } = outcome.result;
      await notifyQuietly("low-stock", () =>
        checkAndAlertLowStockMany(
          scope.officeId,
          gaps.map((g) => g.itemId),
        ),
      );

      return {
        ok: true,
        office: scope.officeName,
        counted: lines.map((l) => ({
          item: l.itemName,
          expectedQty: l.expectedQty,
          countedQty: l.countedQty,
          delta: l.delta,
        })),
        missing,
        surplus,
        message:
          gaps.length === 0
            ? "Count matches the app exactly — nothing to bill."
            : `${missing} missing, ${surplus} extra. The missing cans are billed to this period's drinkers; call matecrew_admin_preview_reimbursements to see the effect.`,
      };
    },
  );
}
