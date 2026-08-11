import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { getTodayDate, toISODateString } from "@/lib/date";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { stockDeltaOps } from "@/lib/stock";
import { McpToolError, resolveAdminOffice } from "@/lib/mcp/context";
import { notifyQuietly } from "@/lib/mcp/notify";
import { defineTool } from "@/lib/mcp/tool";
import { isoDateArg, officeArg, parseIsoDate } from "@/lib/mcp/schemas";
import { findOfficeMember } from "@/lib/mcp/tools/admin-purchases";

export function registerAdminConsumptionTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_admin_record_consumption",
      title: "Record consumption for others",
      description:
        "Backfill maté consumption on behalf of office members — for cans drunk without being logged, or history migrated from a spreadsheet. Each entry counts towards that person's reimbursement share. Set deductStock false when the cans were already removed from the count by a separate stock correction, otherwise they would be subtracted twice. Not idempotent: calling it again records the entries again.",
      inputSchema: {
        office: officeArg,
        entries: z
          .array(
            z.object({
              person: z
                .string()
                .describe("Email (preferred) or name of the office member."),
              item: z
                .string()
                .optional()
                .describe("Item id or name. Omit for the office default item."),
              date: isoDateArg.describe("Day the maté was drunk."),
              qty: z
                .number()
                .int()
                .positive()
                .describe("Number of cans. Defaults to 1 if omitted upstream."),
            }),
          )
          .min(1)
          .max(200)
          .describe("One entry per person/item/day."),
        deductStock: z
          .boolean()
          .optional()
          .describe(
            "Whether to also subtract these cans from stock. Defaults to true.",
          ),
      },
    },
    async ({ office, entries, deductStock }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const deduct = deductStock ?? true;

      const defaultItem = await prisma.item.findFirst({
        where: { officeId: scope.officeId, isDefault: true },
        select: { id: true, name: true },
      });

      // Resolve and validate everything before writing anything — a partial
      // backfill is far worse than a rejected one.
      const resolved: {
        userId: string;
        personName: string;
        itemId: string;
        itemName: string;
        date: Date;
        qty: number;
      }[] = [];
      const deductByItem = new Map<string, number>();

      for (const entry of entries) {
        const member = await findOfficeMember(scope.officeId, entry.person);

        let itemId = defaultItem?.id;
        let itemName = defaultItem?.name;
        if (entry.item) {
          const wanted = entry.item.trim();
          const item = await prisma.item.findFirst({
            where: {
              officeId: scope.officeId,
              OR: [
                { id: wanted },
                { name: { equals: wanted, mode: "insensitive" } },
              ],
            },
            select: { id: true, name: true },
          });
          if (!item) {
            throw new McpToolError(
              `No item called "${entry.item}" in ${scope.officeName}.`,
            );
          }
          itemId = item.id;
          itemName = item.name;
        }
        if (!itemId || !itemName) {
          throw new McpToolError(
            `${scope.officeName} has no default item, so every entry must name an item.`,
          );
        }

        const date = parseIsoDate(entry.date);
        if (date > getTodayDate()) {
          throw new McpToolError(
            `${entry.date} is in the future — consumption can only be recorded for today or earlier.`,
          );
        }

        resolved.push({
          userId: member.userId,
          personName: member.name,
          itemId,
          itemName,
          date,
          qty: entry.qty,
        });

        if (deduct) {
          deductByItem.set(itemId, (deductByItem.get(itemId) ?? 0) + entry.qty);
        }
      }

      // Every item must have enough stock for the whole batch.
      if (deductByItem.size > 0) {
        const stocks = await prisma.stock.findMany({
          where: {
            officeId: scope.officeId,
            itemId: { in: [...deductByItem.keys()] },
          },
          select: { itemId: true, currentQty: true, item: { select: { name: true } } },
        });
        for (const [itemId, needed] of deductByItem) {
          const row = stocks.find((s) => s.itemId === itemId);
          const available = row?.currentQty ?? 0;
          if (needed > available) {
            throw new McpToolError(
              `Not enough ${row?.item.name ?? "stock"}: the batch needs ${needed} but only ${available} are counted. Either correct the stock first, or pass deductStock: false if these cans were already removed from the count.`,
            );
          }
        }
      }

      await prisma.$transaction([
        ...resolved.map((r) =>
          prisma.consumptionEntry.create({
            data: {
              officeId: scope.officeId,
              userId: r.userId,
              itemId: r.itemId,
              date: r.date,
              qty: r.qty,
              source: "MANUAL",
            },
          }),
        ),
        ...[...deductByItem.entries()].flatMap(([itemId, qty]) =>
          stockDeltaOps({
            officeId: scope.officeId,
            itemId,
            delta: -qty,
            reason: "SERVED",
            note: `Backfilled consumption (${qty})`,
            userId: actor.userId,
          }),
        ),
      ]);

      for (const itemId of deductByItem.keys()) {
        await notifyQuietly("low-stock", () =>
          checkAndAlertLowStock(scope.officeId, itemId),
        );
      }

      return {
        ok: true,
        recorded: resolved.length,
        totalCans: resolved.reduce((sum, r) => sum + r.qty, 0),
        stockDeducted: deduct,
        entries: resolved.map((r) => ({
          person: r.personName,
          item: r.itemName,
          date: toISODateString(r.date),
          qty: r.qty,
        })),
        message: `Recorded ${resolved.length} consumption entr${
          resolved.length === 1 ? "y" : "ies"
        } in ${scope.officeName}${deduct ? " and deducted them from stock" : " without touching stock"}.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_cancel_consumption",
      title: "Cancel anyone's consumption",
      description:
        "Cancel a consumption entry belonging to any office member — a correction an admin can make on someone else's behalf. The can returns to stock and stops counting towards their reimbursement share.",
      inputSchema: {
        office: officeArg,
        entryId: z.string().describe("Consumption entry id."),
      },
      destructive: true,
      idempotent: true,
    },
    async ({ office, entryId }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);

      const entry = await prisma.consumptionEntry.findUnique({
        where: { id: entryId },
        include: {
          item: { select: { name: true } },
          user: { select: { name: true } },
        },
      });
      if (!entry || entry.officeId !== scope.officeId) {
        throw new McpToolError(
          `No consumption entry with id ${entryId} in ${scope.officeName}.`,
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
          note: "Cancelled by admin",
          userId: actor.userId,
        }),
      ]);

      return {
        ok: true,
        person: entry.user.name,
        item: entry.item.name,
        qty: entry.qty,
        message: `Cancelled ${entry.qty} × ${entry.item.name} for ${entry.user.name} on ${toISODateString(
          entry.date,
        )}.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_consumption_report",
      title: "Consumption report by person",
      description:
        "Who drank what over a date range, across the whole office. Use this to check a month before generating its reimbursement period, or to investigate a disputed total.",
      inputSchema: {
        office: officeArg,
        from: isoDateArg.describe("Start of the range, inclusive."),
        to: isoDateArg.describe("End of the range, inclusive."),
      },
      readOnly: true,
      idempotent: true,
    },
    async ({ office, from, to }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const start = parseIsoDate(from);
      const end = parseIsoDate(to);
      if (start > end) {
        throw new McpToolError("`from` must not be later than `to`.");
      }

      const entries = await prisma.consumptionEntry.findMany({
        where: {
          officeId: scope.officeId,
          cancelledAt: null,
          date: { gte: start, lte: end },
        },
        select: {
          qty: true,
          user: { select: { id: true, name: true } },
          item: { select: { name: true } },
        },
      });

      const byPerson = new Map<
        string,
        { name: string; qty: number; byItem: Map<string, number> }
      >();
      for (const e of entries) {
        let row = byPerson.get(e.user.id);
        if (!row) {
          row = { name: e.user.name, qty: 0, byItem: new Map() };
          byPerson.set(e.user.id, row);
        }
        row.qty += e.qty;
        row.byItem.set(
          e.item.name,
          (row.byItem.get(e.item.name) ?? 0) + e.qty,
        );
      }

      return {
        office: scope.officeName,
        range: { from, to },
        totalCans: entries.reduce((sum, e) => sum + e.qty, 0),
        people: [...byPerson.values()]
          .sort((a, b) => b.qty - a.qty)
          .map((p) => ({
            name: p.name,
            qty: p.qty,
            byItem: Object.fromEntries(p.byItem),
          })),
      };
    },
  );
}
