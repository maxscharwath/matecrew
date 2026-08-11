import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { stockDeltaOps } from "@/lib/stock";
import { McpToolError, resolveAdminOffice } from "@/lib/mcp/context";
import { notifyQuietly } from "@/lib/mcp/notify";
import { defineTool } from "@/lib/mcp/tool";
import { isoDateArg, officeArg, parseIsoDate } from "@/lib/mcp/schemas";

/**
 * Purchases are the bulk orders that fund the fridge. An order is recorded as
 * ORDERED and adds nothing to stock; marking it DELIVERED is what puts the cans
 * on the shelf. Each line's unit price feeds the per-item weighted average used
 * to bill consumption, so quantities and totals have to be right.
 */
export function registerAdminPurchaseTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_admin_list_purchases",
      title: "List purchase orders",
      description:
        "Maté orders placed for an office, newest first: what was bought, at what price, who paid, and whether the delivery has been recorded. Orders still marked ORDERED have not been added to stock yet.",
      inputSchema: {
        office: officeArg,
        status: z
          .enum(["ORDERED", "DELIVERED"])
          .optional()
          .describe("Filter by status. Omit for both."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum orders to return. Defaults to 20."),
      },
      readOnly: true,
      idempotent: true,
    },
    async ({ office, status, limit }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const batches = await prisma.purchaseBatch.findMany({
        where: { officeId: scope.officeId, ...(status ? { status } : {}) },
        orderBy: { purchasedAt: "desc" },
        take: limit ?? 20,
        include: {
          lines: { include: { item: { select: { name: true } } } },
          orderedBy: { select: { name: true } },
          paidBy: { select: { name: true } },
          invoices: { select: { id: true, filename: true } },
        },
      });

      return {
        office: scope.officeName,
        purchases: batches.map((b) => ({
          purchaseId: b.id,
          status: b.status,
          purchasedAt: b.purchasedAt,
          deliveredAt: b.deliveredAt,
          orderedBy: b.orderedBy.name,
          paidBy: b.paidBy.name,
          totalPrice: b.totalPrice,
          notes: b.notes,
          lines: b.lines.map((l) => ({
            item: l.item.name,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
          invoiceCount: b.invoices.length,
        })),
        pendingDeliveries: batches
          .filter((b) => b.status === "ORDERED")
          .map((b) => b.id),
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_create_purchase",
      title: "Record a purchase order",
      description:
        "Record a maté order that was placed. Stock is NOT increased yet — call matecrew_admin_mark_delivered when it arrives. The person who paid gets credited in the reimbursement calculation, so name them correctly. Invoice files can only be attached from the web app.",
      inputSchema: {
        office: officeArg,
        lines: z
          .array(
            z.object({
              item: z.string().describe("Item id or name."),
              qty: z
                .number()
                .int()
                .positive()
                .describe("Number of cans bought on this line."),
              total: z
                .number()
                .positive()
                .describe(
                  "Total price for this line (not per can) — the unit price is derived from total / qty.",
                ),
            }),
          )
          .min(1)
          .describe("One entry per item bought."),
        paidBy: z
          .string()
          .describe(
            "Email or name of the office member who actually paid. They get credited for the spend.",
          ),
        purchasedAt: isoDateArg
          .optional()
          .describe("Date of the order. Defaults to today."),
        notes: z.string().max(500).optional(),
      },
    },
    async ({ office, lines, paidBy, purchasedAt, notes }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);

      const payer = await findOfficeMember(scope.officeId, paidBy);

      // Resolve every line's item up front so a typo fails before any write.
      const resolved = [];
      for (const line of lines) {
        const wanted = line.item.trim();
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
            `No item called "${line.item}" in ${scope.officeName}.`,
          );
        }
        resolved.push({
          itemId: item.id,
          itemName: item.name,
          qty: line.qty,
          unitPrice: Math.round((line.total / line.qty) * 100) / 100,
          lineTotal: Math.round(line.total * 100) / 100,
        });
      }

      const totalPrice =
        Math.round(resolved.reduce((sum, l) => sum + l.lineTotal, 0) * 100) /
        100;

      const batch = await prisma.purchaseBatch.create({
        data: {
          officeId: scope.officeId,
          status: "ORDERED",
          purchasedAt: purchasedAt ? parseIsoDate(purchasedAt) : new Date(),
          orderedByUserId: actor.userId,
          paidByUserId: payer.userId,
          totalPrice,
          notes: notes || null,
          lines: {
            create: resolved.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
            })),
          },
        },
        select: { id: true, purchasedAt: true },
      });

      return {
        ok: true,
        purchaseId: batch.id,
        status: "ORDERED",
        purchasedAt: batch.purchasedAt,
        paidBy: payer.name,
        totalPrice,
        totalCans: resolved.reduce((sum, l) => sum + l.qty, 0),
        lines: resolved.map((l) => ({
          item: l.itemName,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
        message: `Recorded a ${totalPrice} CHF order paid by ${payer.name}. Stock is unchanged until you mark it delivered.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_mark_delivered",
      title: "Record a delivery",
      description:
        "Mark a purchase order as delivered, which adds its cans to stock. Do this when the boxes actually arrive.",
      inputSchema: {
        office: officeArg,
        purchaseId: z
          .string()
          .describe("Purchase id from matecrew_admin_list_purchases."),
      },
      idempotent: true,
    },
    async ({ office, purchaseId }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);

      const batch = await prisma.purchaseBatch.findUnique({
        where: { id: purchaseId },
        include: { lines: { include: { item: { select: { name: true } } } } },
      });
      if (!batch || batch.officeId !== scope.officeId) {
        throw new McpToolError(
          `No purchase order with id ${purchaseId} in ${scope.officeName}.`,
        );
      }
      if (batch.status === "DELIVERED") {
        return {
          ok: true,
          status: "already_delivered",
          deliveredAt: batch.deliveredAt,
          message: "That order was already marked delivered — stock unchanged.",
        };
      }

      // One order may list the same item on several lines; the stock pool takes
      // a single delta per item.
      const qtyByItem = new Map<string, { qty: number; name: string }>();
      for (const line of batch.lines) {
        const entry = qtyByItem.get(line.itemId);
        qtyByItem.set(line.itemId, {
          qty: (entry?.qty ?? 0) + line.qty,
          name: line.item.name,
        });
      }

      await prisma.$transaction([
        prisma.purchaseBatch.update({
          where: { id: purchaseId },
          data: { status: "DELIVERED", deliveredAt: new Date() },
        }),
        ...[...qtyByItem.entries()].flatMap(([itemId, { qty }]) =>
          stockDeltaOps({
            officeId: scope.officeId,
            itemId,
            delta: qty,
            reason: "PURCHASE",
            note: `Delivery received: ${qty} units`,
            userId: actor.userId,
          }),
        ),
      ]);

      for (const itemId of qtyByItem.keys()) {
        await notifyQuietly("low-stock", () =>
          checkAndAlertLowStock(scope.officeId, itemId),
        );
      }

      const stockNow = await prisma.stock.findMany({
        where: {
          officeId: scope.officeId,
          itemId: { in: [...qtyByItem.keys()] },
        },
        select: { itemId: true, currentQty: true },
      });

      return {
        ok: true,
        purchaseId,
        added: [...qtyByItem.entries()].map(([itemId, { qty, name }]) => ({
          item: name,
          added: qty,
          stockNow:
            stockNow.find((s) => s.itemId === itemId)?.currentQty ?? null,
        })),
        message: `Delivery recorded — added ${[...qtyByItem.values()].reduce(
          (sum, v) => sum + v.qty,
          0,
        )} cans to ${scope.officeName}.`,
      };
    },
  );
}

/**
 * Resolves an office member by email or name. Email is exact (it is unique);
 * name has to be unambiguous, since two colleagues can share one.
 */
export async function findOfficeMember(
  officeId: string,
  identifier: string,
): Promise<{ userId: string; name: string; email: string }> {
  const wanted = identifier.trim();
  const members = await prisma.membership.findMany({
    where: { officeId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });

  const byEmail = members.find(
    (m) => m.user.email.toLowerCase() === wanted.toLowerCase(),
  );
  const chosen = byEmail
    ? [byEmail]
    : members.filter(
        (m) => m.user.name.toLowerCase() === wanted.toLowerCase(),
      );

  if (chosen.length === 0) {
    const alsoById = members.find((m) => m.user.id === wanted);
    if (alsoById) {
      return {
        userId: alsoById.user.id,
        name: alsoById.user.name,
        email: alsoById.user.email,
      };
    }
    throw new McpToolError(
      `"${identifier}" is not a member of this office. Members: ${members
        .map((m) => `${m.user.name} <${m.user.email}>`)
        .join(", ")}.`,
    );
  }
  if (chosen.length > 1) {
    throw new McpToolError(
      `Several members are called "${identifier}" — use their email instead: ${chosen
        .map((m) => m.user.email)
        .join(", ")}.`,
    );
  }

  return {
    userId: chosen[0].user.id,
    name: chosen[0].user.name,
    email: chosen[0].user.email,
  };
}
