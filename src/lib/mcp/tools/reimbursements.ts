import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { toISODateString } from "@/lib/date";
import { McpToolError, resolveOffice } from "@/lib/mcp/context";
import { defineTool } from "@/lib/mcp/tool";
import { officeArg } from "@/lib/mcp/schemas";
import { roundCents } from "@/lib/money";

/**
 * The money side, from a member's point of view. Reimbursement periods are
 * generated monthly by an admin or the cron; each holds frozen payment lines
 * saying who owes whom. A member sees the lines they are part of and can settle
 * their own.
 */
export function registerReimbursementTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_my_reimbursements",
      title: "What I owe and am owed",
      description:
        "The caller's outstanding and settled maté payments across reimbursement periods: who they owe, who owes them, and the net balance. Amounts are frozen when a period is generated, so they do not drift.",
      inputSchema: {
        office: officeArg,
        includePaid: z
          .boolean()
          .optional()
          .describe(
            "Include already-settled lines. Defaults to false (pending only).",
          ),
      },
      readOnly: true,
      idempotent: true,
    },
    async ({ office, includePaid }, { actor }) => {
      const scope = await resolveOffice(actor, office);

      const lines = await prisma.reimbursementLine.findMany({
        where: {
          period: { officeId: scope.officeId },
          OR: [{ fromUserId: actor.userId }, { toUserId: actor.userId }],
          ...(includePaid ? {} : { status: "PENDING" }),
        },
        include: {
          fromUser: { select: { id: true, name: true } },
          toUser: { select: { id: true, name: true } },
          period: { select: { id: true, month: true, year: true } },
        },
        orderBy: [
          { period: { year: "desc" } },
          { period: { month: "desc" } },
        ],
      });

      let owe = 0;
      let owed = 0;
      const rows = lines.map((line) => {
        const amount = line.amount.toNumber();
        const youOwe = line.fromUserId === actor.userId;
        if (line.status === "PENDING") {
          if (youOwe) owe += amount;
          else owed += amount;
        }
        return {
          lineId: line.id,
          period: `${line.period.year}-${String(line.period.month).padStart(2, "0")}`,
          direction: youOwe ? "you_owe" : "owed_to_you",
          counterparty: youOwe ? line.toUser.name : line.fromUser.name,
          amount,
          currency: line.currency,
          status: line.status,
          paidAt: line.paidAt,
        };
      });

      return {
        office: scope.officeName,
        pendingTotalYouOwe: roundCents(owe),
        pendingTotalOwedToYou: roundCents(owed),
        netBalance: roundCents(owe - owed),
        lines: rows,
        note:
          rows.length === 0
            ? "No reimbursement lines involve you. Periods are created monthly — an admin can generate them with matecrew_admin_generate_periods."
            : undefined,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_settle_payment",
      title: "Mark a payment as settled",
      description:
        "Record that a maté reimbursement has actually been paid. The caller must be the debtor or the creditor on that line, or an admin of the office. Only an admin can undo it (matecrew_admin_unsettle_payment).",
      inputSchema: {
        office: officeArg,
        lineId: z
          .string()
          .describe("Payment line id from matecrew_my_reimbursements."),
      },
      idempotent: true,
    },
    async ({ office, lineId }, { actor }) => {
      const scope = await resolveOffice(actor, office);

      const line = await prisma.reimbursementLine.findUnique({
        where: { id: lineId },
        include: {
          period: { select: { officeId: true, month: true, year: true } },
          fromUser: { select: { name: true } },
          toUser: { select: { name: true } },
        },
      });
      if (!line || line.period.officeId !== scope.officeId) {
        throw new McpToolError(
          `No payment line with id ${lineId} in this office.`,
        );
      }

      // Same rule as the web app: only the two parties or an admin may settle.
      const isInvolved =
        line.fromUserId === actor.userId || line.toUserId === actor.userId;
      if (!isInvolved && !scope.isAdmin) {
        throw new McpToolError(
          "That payment is between two other people, and you are not an admin of this office.",
        );
      }

      if (line.status === "PAID") {
        return {
          ok: true,
          status: "already_paid",
          message: `That payment was already marked paid${
            line.paidAt ? ` on ${toISODateString(line.paidAt)}` : ""
          }.`,
        };
      }

      await prisma.reimbursementLine.update({
        where: { id: lineId },
        data: { status: "PAID", paidAt: new Date() },
      });

      return {
        ok: true,
        amount: line.amount.toNumber(),
        currency: line.currency,
        from: line.fromUser.name,
        to: line.toUser.name,
        message: `Marked ${line.amount.toNumber()} ${line.currency} from ${
          line.fromUser.name
        } to ${line.toUser.name} as paid.`,
      };
    },
  );
}
