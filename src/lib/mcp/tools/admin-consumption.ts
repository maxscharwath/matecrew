import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { BatchConflictError, commitBatch, expectRows, prisma, retryOnConflict } from "@/lib/prisma";
import { findByIdOrName } from "@/lib/mcp/name-match";
import { getTodayDate, toISODateString } from "@/lib/date";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { stockAtLeast, stockDeltaOps } from "@/lib/stock";
import { McpToolError, resolveAdminOffice, type OfficeScope } from "@/lib/mcp/context";
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

      // Resolve and validate everything before writing anything — a partial
      // backfill is far worse than a rejected one.
      const resolved = await resolveEntries(scope, entries);
      const deductByItem = new Map<string, number>();
      if (deduct) {
        for (const r of resolved) deductByItem.set(r.itemId, (deductByItem.get(r.itemId) ?? 0) + r.qty);
      }

      await retryOnConflict(() => recordEntries(scope.officeId, resolved, deductByItem, actor.userId));

      await Promise.all(
        [...deductByItem.keys()].map((itemId) =>
          notifyQuietly("low-stock", () => checkAndAlertLowStock(scope.officeId, itemId)),
        ),
      );

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

      // Read above, one atomic batch here. The guard only cancels an entry
      // that is still live, so a repeated call cannot restock twice.
      try {
        await commitBatch((db) => [
          expectRows(
            db.consumptionEntry.updateMany({
              where: { id: entryId, cancelledAt: null },
              data: { cancelledAt: new Date() },
            }),
            1,
          ),
          ...stockDeltaOps(db, {
            officeId: scope.officeId,
            itemId: entry.itemId,
            delta: entry.qty,
            reason: "UNSERVED",
            note: "Cancelled by admin",
            userId: actor.userId,
          }),
        ]);
      } catch (error) {
        if (!(error instanceof BatchConflictError)) throw error;
        return { ok: true, status: "already_cancelled", message: "That entry was already cancelled." };
      }

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

interface ResolvedEntry {
  readonly userId: string;
  readonly personName: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly date: Date;
  readonly qty: number;
}

interface EntryInput {
  readonly person: string;
  readonly item?: string;
  readonly date: string;
  readonly qty: number;
}

/** Resolves each entry's member, item (the office default when omitted) and day, or throws on the first invalid one. */
async function resolveEntries(scope: OfficeScope, entries: readonly EntryInput[]): Promise<ResolvedEntry[]> {
  const persons = [...new Set(entries.map((e) => e.person))];
  const [items, members] = await Promise.all([
    prisma.item.findMany({ where: { officeId: scope.officeId }, select: { id: true, name: true, isDefault: true } }),
    Promise.all(persons.map((person) => findOfficeMember(scope.officeId, person))),
  ]);
  const memberOf = new Map(persons.map((person, index) => [person, members[index]]));
  const defaultItem = items.find((i) => i.isDefault);
  const today = getTodayDate();

  return entries.map((entry) => {
    const member = memberOf.get(entry.person);
    if (!member) throw new McpToolError(`"${entry.person}" is not a member of ${scope.officeName}.`);
    const item = entry.item ? findByIdOrName(items, entry.item.trim()) : defaultItem;
    if (entry.item && !item) {
      throw new McpToolError(`No item called "${entry.item}" in ${scope.officeName}.`);
    }
    if (!item) {
      throw new McpToolError(`${scope.officeName} has no default item, so every entry must name an item.`);
    }
    const date = parseIsoDate(entry.date);
    if (date > today) {
      throw new McpToolError(
        `${entry.date} is in the future — consumption can only be recorded for today or earlier.`,
      );
    }
    return { userId: member.userId, personName: member.name, itemId: item.id, itemName: item.name, date, qty: entry.qty };
  });
}

/**
 * Checks every item has enough stock for the whole backfill, then records it
 * in one atomic batch. Each pool is guarded at the level the check saw: a take
 * in between rolls the batch back and `retryOnConflict` checks again.
 */
async function recordEntries(
  officeId: string,
  resolved: readonly ResolvedEntry[],
  deductByItem: ReadonlyMap<string, number>,
  actingUserId: string,
): Promise<void> {
  if (deductByItem.size > 0) {
    const stocks = await prisma.stock.findMany({
      where: { officeId, itemId: { in: [...deductByItem.keys()] } },
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

  await commitBatch((db) => [
    ...[...deductByItem.entries()].map(([itemId, qty]) => stockAtLeast(db, officeId, itemId, qty)),
    db.consumptionEntry.createMany({
      data: resolved.map((r) => ({
        officeId,
        userId: r.userId,
        itemId: r.itemId,
        date: r.date,
        qty: r.qty,
        source: "MANUAL" as const,
      })),
    }),
    ...[...deductByItem.entries()].flatMap(([itemId, qty]) =>
      stockDeltaOps(db, {
        officeId,
        itemId,
        delta: -qty,
        reason: "SERVED",
        note: `Backfilled consumption (${qty})`,
        userId: actingUserId,
      }),
    ),
  ]);
}
