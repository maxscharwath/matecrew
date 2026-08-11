import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { getTodayDate, toISODateString } from "@/lib/date";
import { stockDeltaOps } from "@/lib/stock";
import { McpToolError, resolveOffice } from "@/lib/mcp/context";
import { defineTool } from "@/lib/mcp/tool";
import { isoDateArg, officeArg, parseIsoDate } from "@/lib/mcp/schemas";

const DAY_MS = 24 * 60 * 60 * 1000;

export function registerConsumptionTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_my_consumption",
      title: "My consumption history",
      description:
        "The caller's own maté consumption over a date range, with per-item totals and the individual entries (including their ids, so a mistake can be reversed). Cancelled entries are listed but excluded from the totals.",
      inputSchema: {
        office: officeArg,
        from: isoDateArg
          .optional()
          .describe("Start of the range, inclusive. Defaults to 30 days ago."),
        to: isoDateArg
          .optional()
          .describe("End of the range, inclusive. Defaults to today."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum entries to list, newest first. Defaults to 100."),
      },
      readOnly: true,
      idempotent: true,
    },
    async ({ office, from, to, limit }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      // Both bounds must land on UTC midnight to line up with the `@db.Date`
      // column: a `gte` carrying a time-of-day would silently drop that day.
      const end = to ? parseIsoDate(to) : getTodayDate();
      const start = from
        ? parseIsoDate(from)
        : new Date(end.getTime() - 30 * DAY_MS);

      if (start > end) {
        throw new McpToolError("`from` must not be later than `to`.");
      }

      const entries = await prisma.consumptionEntry.findMany({
        where: {
          officeId: scope.officeId,
          userId: actor.userId,
          date: { gte: start, lte: end },
        },
        include: { item: { select: { name: true } } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: limit ?? 100,
      });

      const active = entries.filter((e) => e.cancelledAt === null);
      const byItem = new Map<string, number>();
      for (const e of active) {
        byItem.set(e.item.name, (byItem.get(e.item.name) ?? 0) + e.qty);
      }

      return {
        office: scope.officeName,
        range: { from: toISODateString(start), to: toISODateString(end) },
        totalQty: active.reduce((sum, e) => sum + e.qty, 0),
        byItem: [...byItem.entries()]
          .map(([item, qty]) => ({ item, qty }))
          .sort((a, b) => b.qty - a.qty),
        entries: entries.map((e) => ({
          entryId: e.id,
          date: toISODateString(e.date),
          item: e.item.name,
          qty: e.qty,
          source: e.source,
          cancelled: e.cancelledAt !== null,
        })),
        truncated: entries.length === (limit ?? 100),
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_cancel_consumption",
      title: "Cancel one of my consumptions",
      description:
        "Reverse one of the caller's own recorded consumptions — a can they were charged for but did not drink. The can goes back into stock and stops counting towards their reimbursement share. Callers can only cancel their own entries.",
      inputSchema: {
        office: officeArg,
        entryId: z
          .string()
          .describe("Consumption entry id from matecrew_my_consumption."),
      },
      destructive: true,
      idempotent: true,
    },
    async ({ office, entryId }, { actor }) => {
      const scope = await resolveOffice(actor, office);

      const entry = await prisma.consumptionEntry.findUnique({
        where: { id: entryId },
        include: { item: { select: { name: true } } },
      });
      if (!entry || entry.officeId !== scope.officeId) {
        throw new McpToolError(
          `No consumption entry with id ${entryId} in this office.`,
        );
      }
      if (entry.userId !== actor.userId) {
        throw new McpToolError(
          "That consumption belongs to someone else — you can only cancel your own.",
        );
      }
      if (entry.cancelledAt) {
        return {
          ok: true,
          status: "already_cancelled",
          message: "That entry was already cancelled.",
        };
      }

      await prisma.$transaction([
        prisma.consumptionEntry.update({
          where: { id: entryId },
          data: { cancelledAt: new Date() },
        }),
        ...stockDeltaOps({
          officeId: scope.officeId,
          itemId: entry.itemId,
          delta: entry.qty,
          reason: "UNSERVED",
          note: "Consumption cancelled by user",
          userId: actor.userId,
        }),
      ]);

      return {
        ok: true,
        item: entry.item.name,
        qty: entry.qty,
        date: toISODateString(entry.date),
        message: `Cancelled ${entry.qty} × ${entry.item.name} from ${toISODateString(
          entry.date,
        )} and returned it to stock.`,
      };
    },
  );
}
