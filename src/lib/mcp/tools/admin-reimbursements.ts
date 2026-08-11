import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { toISODateString } from "@/lib/date";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import {
  backfillReimbursementPeriods,
  syncReimbursementPeriod,
} from "@/lib/reimbursement-periods";
import {
  buildSettlementKey,
  buildUserSettlementKey,
  deleteFile,
} from "@/lib/storage";
import { McpToolError, resolveAdminOffice } from "@/lib/mcp/context";
import { defineTool } from "@/lib/mcp/tool";
import { officeArg } from "@/lib/mcp/schemas";

const monthArg = z.number().int().min(1).max(12).describe("Month, 1-12.");
const yearArg = z.number().int().min(2000).max(2100).describe("Four-digit year.");

export function registerAdminReimbursementTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_admin_list_periods",
      title: "List reimbursement periods",
      description:
        "Every monthly reimbursement period for an office, with its payment lines and how much is still outstanding. Amounts are frozen at generation time.",
      inputSchema: {
        office: officeArg,
        limit: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe("Most recent periods to return. Defaults to 12."),
      },
      readOnly: true,
      idempotent: true,
    },
    async ({ office, limit }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const periods = await prisma.reimbursementPeriod.findMany({
        where: { officeId: scope.officeId },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        take: limit ?? 12,
        include: {
          lines: {
            include: {
              fromUser: { select: { name: true } },
              toUser: { select: { name: true } },
            },
          },
        },
      });

      return {
        office: scope.officeName,
        periods: periods.map((p) => {
          const outstanding = p.lines
            .filter((l) => l.status === "PENDING")
            .reduce((sum, l) => sum + l.amount.toNumber(), 0);
          return {
            periodId: p.id,
            label: `${p.year}-${String(p.month).padStart(2, "0")}`,
            month: p.month,
            year: p.year,
            startDate: toISODateString(p.startDate),
            endDate: toISODateString(p.endDate),
            totalAmount:
              Math.round(
                p.lines.reduce((sum, l) => sum + l.amount.toNumber(), 0) * 100,
              ) / 100,
            outstanding: Math.round(outstanding * 100) / 100,
            allSettled: p.lines.every((l) => l.status === "PAID"),
            lines: p.lines.map((l) => ({
              lineId: l.id,
              from: l.fromUser.name,
              to: l.toUser.name,
              amount: l.amount,
              currency: l.currency,
              status: l.status,
              paidAt: l.paidAt,
            })),
          };
        }),
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_preview_reimbursements",
      title: "Preview a reimbursement calculation",
      description:
        "Compute what a date range would settle to, WITHOUT creating a period or changing anything: each person's consumption, cost share and what they paid, the per-item prices used, and the proposed transfers. Use this to sanity-check a month before generating it.",
      inputSchema: {
        office: officeArg,
        month: monthArg,
        year: yearArg,
      },
      readOnly: true,
      idempotent: true,
    },
    async ({ office, month, year }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const startDate = new Date(Date.UTC(year, month - 1, 1));
      // Day 0 of the following month is the last day of this one.
      const endDate = new Date(Date.UTC(year, month, 0));

      const result = await calculateReimbursements(
        scope.officeId,
        startDate,
        endDate,
      );

      return {
        office: scope.officeName,
        period: `${year}-${String(month).padStart(2, "0")}`,
        range: {
          from: toISODateString(startDate),
          to: toISODateString(endDate),
        },
        totalConsumption: result.totalConsumption,
        totalCost: round2(result.totalCost),
        avgUnitPrice: round2(result.avgUnitPrice),
        itemPrices: result.itemPrices.map((i) => ({
          item: i.itemName,
          unitPrice: round2(i.unitPrice),
          qtyConsumed: i.qtyConsumed,
          cost: round2(i.cost),
        })),
        shares: result.shares.map((s) => ({
          name: s.userName,
          qty: s.qty,
          costShare: round2(s.costShare),
          amountPaid: round2(s.amountPaid),
          netOwed: round2(s.netOwed),
        })),
        proposedTransfers: result.lines.map((l) => ({
          from: l.fromUserName,
          to: l.toUserName,
          amount: round2(l.amount),
        })),
        note: "Nothing was saved. Use matecrew_admin_generate_periods to create the period for real.",
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_generate_periods",
      title: "Generate missing reimbursement periods",
      description:
        "Create a reimbursement period for every complete month since the office's first activity that does not have one yet. The current month is skipped because it is not over. Months with no consumption and no spend are skipped. Existing periods are never touched, so this is safe to re-run.",
      inputSchema: { office: officeArg },
      idempotent: true,
    },
    async ({ office }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const result = await backfillReimbursementPeriods(scope.officeId);

      if (result.kind === "no_activity") {
        throw new McpToolError(
          `${scope.officeName} has no consumption or purchases recorded yet, so there is nothing to bill.`,
        );
      }

      return {
        ok: true,
        created: result.created,
        message:
          result.created === 0
            ? "Every complete month already has a period — nothing to create."
            : `Created ${result.created} reimbursement period(s) for ${scope.officeName}.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_sync_period",
      title: "Recalculate a period",
      description:
        "Recompute a period's unpaid payment lines from current data — for after a late purchase was recorded or a consumption was corrected. Lines already marked paid are left alone and their amounts are deducted from the residual balances, so nobody is asked to pay twice.",
      inputSchema: {
        office: officeArg,
        periodId: z
          .string()
          .describe("Period id from matecrew_admin_list_periods."),
      },
      idempotent: true,
    },
    async ({ office, periodId }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const result = await syncReimbursementPeriod(scope.officeId, periodId);

      if (result.kind === "not_found") {
        throw new McpToolError(
          `No reimbursement period with id ${periodId} in ${scope.officeName}.`,
        );
      }

      return {
        ok: true,
        lines: result.lines,
        message: `Recalculated the period — it now has ${result.lines} payment line(s). Paid lines were preserved.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_unsettle_payment",
      title: "Undo a settled payment",
      description:
        "Put a payment line back to pending because it was marked paid by mistake. Admin only — the two parties can mark a payment paid but not unpaid.",
      inputSchema: {
        office: officeArg,
        lineId: z.string().describe("Payment line id."),
      },
      destructive: true,
      idempotent: true,
    },
    async ({ office, lineId }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);

      const line = await prisma.reimbursementLine.findUnique({
        where: { id: lineId },
        include: {
          period: { select: { officeId: true } },
          fromUser: { select: { name: true } },
          toUser: { select: { name: true } },
        },
      });
      if (!line || line.period.officeId !== scope.officeId) {
        throw new McpToolError(
          `No payment line with id ${lineId} in ${scope.officeName}.`,
        );
      }
      if (line.status === "PENDING") {
        return {
          ok: true,
          status: "already_pending",
          message: "That payment was already pending.",
        };
      }

      await prisma.reimbursementLine.update({
        where: { id: lineId },
        data: { status: "PENDING", paidAt: null },
      });

      return {
        ok: true,
        message: `${line.amount.toNumber()} ${line.currency} from ${line.fromUser.name} to ${line.toUser.name} is pending again.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_delete_period",
      title: "Delete a reimbursement period",
      description:
        "Delete a reimbursement period and all of its payment lines, including ones already marked paid. This destroys the record of who settled what for that month and cannot be undone — regenerating produces fresh lines that are all unpaid. Prefer matecrew_admin_sync_period to fix wrong amounts.",
      inputSchema: {
        office: officeArg,
        periodId: z.string().describe("Period id to delete."),
        confirm: z
          .literal(true)
          .describe(
            "Must be true. Confirm with the user before passing it — settled payment records are lost.",
          ),
      },
      destructive: true,
      idempotent: true,
    },
    async ({ office, periodId }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);

      const period = await prisma.reimbursementPeriod.findUnique({
        where: { id: periodId },
        include: { lines: { select: { status: true, fromUserId: true, toUserId: true } } },
      });
      if (!period || period.officeId !== scope.officeId) {
        throw new McpToolError(
          `No reimbursement period with id ${periodId} in ${scope.officeName}.`,
        );
      }

      const paidCount = period.lines.filter((l) => l.status === "PAID").length;
      const affectedUserIds = new Set(
        period.lines.flatMap((l) => [l.fromUserId, l.toUserId]),
      );

      await prisma.$transaction([
        prisma.reimbursementLine.deleteMany({ where: { periodId } }),
        prisma.reimbursementPeriod.delete({ where: { id: periodId } }),
      ]);

      // Cached settlement PDFs would otherwise outlive the period.
      await Promise.allSettled([
        deleteFile(buildSettlementKey(periodId)),
        ...[...affectedUserIds].map((uid) =>
          deleteFile(buildUserSettlementKey(periodId, uid)),
        ),
      ]);

      return {
        ok: true,
        deletedPeriod: `${period.year}-${String(period.month).padStart(2, "0")}`,
        deletedLines: period.lines.length,
        paidLinesDestroyed: paidCount,
        message: `Deleted the ${period.year}-${String(period.month).padStart(2, "0")} period and its ${period.lines.length} line(s)${
          paidCount > 0 ? `, including ${paidCount} that were marked paid` : ""
        }.`,
      };
    },
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
