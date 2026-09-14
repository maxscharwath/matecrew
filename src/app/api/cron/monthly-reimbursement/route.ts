import { prisma } from "@/lib/prisma";
import { enqueueTask, verifyQStashSignature } from "@/lib/qstash";
import { calculateReimbursements, type ReimbursementResult } from "@/lib/reimbursement-calc";
import { sendSlackMessage, buildMonthlyBillMessage } from "@/lib/slack";
import { sendPeriodStatements } from "@/lib/settlement-mail";

// The statements are queued rather than mailed here, so this route stays a
// loop over offices; the window is generous only because closing a month also
// replays each office's whole costing ledger.
export const maxDuration = 60;

async function notifySlack(
  office: { id: string; name: string; slackChannelId: string; locale: string },
  month: number,
  year: number,
  result: ReimbursementResult,
  appUrl: string,
) {
  try {
    const { blocks, fallback } = await buildMonthlyBillMessage({
      officeName: office.name,
      month,
      year,
      totalConsumption: result.totalConsumption,
      totalCost: result.totalCost,
      consumers: result.shares.length,
      appUrl,
      officeId: office.id,
      locale: office.locale,
    });
    await sendSlackMessage(office.slackChannelId, blocks, fallback);
  } catch {
    // Best-effort — period was already created
  }
}

/**
 * Monthly reimbursement cron — triggered by Upstash QStash on the 1st of each month.
 * Generates reimbursement periods for the previous month across all offices,
 * then mails every member their own statement for it.
 */
export async function POST(request: Request) {
  if (!(await verifyQStashSignature(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const prevMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  const month = prevMonth.getUTCMonth() + 1;
  const year = prevMonth.getUTCFullYear();
  const startDate = prevMonth;
  const endDate = new Date(Date.UTC(year, month, 0));

  const offices = await prisma.office.findMany({
    select: { id: true, name: true, slackChannelId: true, locale: true },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const results: {
    office: string;
    created: boolean;
    /** How this office's statements were dispatched. */
    statements?: "queued" | "inline" | "failed";
    error?: string;
  }[] = [];

  for (const office of offices) {
    try {
      const existing = await prisma.reimbursementPeriod.findUnique({
        where: {
          officeId_year_month: { officeId: office.id, year, month },
        },
      });

      if (existing) {
        results.push({ office: office.name, created: false });
        continue;
      }

      const result = await calculateReimbursements(
        office.id,
        startDate,
        endDate,
      );

      if (result.totalConsumption === 0 && result.totalCost === 0) {
        results.push({ office: office.name, created: false });
        continue;
      }

      const period = await prisma.reimbursementPeriod.create({
        data: {
          officeId: office.id,
          month,
          year,
          startDate,
          endDate,
          lines: {
            create: result.lines.map((l) => ({
              fromUserId: l.fromUserId,
              toUserId: l.toUserId,
              amount: l.amount,
              currency: "CHF",
            })),
          },
        },
      });

      // Each member gets their own bill by mail — as a queued task per office,
      // so one slow mail provider cannot eat the window every other office is
      // waiting for, and QStash retries the ones that fail. Without QStash
      // configured (local, self-host) it falls back to sending inline rather
      // than dropping the mail.
      let statements: "queued" | "inline" | "failed" = "queued";
      try {
        const queued = await enqueueTask("/api/cron/period-statements", {
          periodId: period.id,
        });
        if (!queued) {
          await sendPeriodStatements(period.id);
          statements = "inline";
        }
      } catch {
        // The period is written and the deliveries are recorded per person,
        // so an admin can re-send from the period card without double-billing.
        statements = "failed";
      }

      results.push({ office: office.name, created: true, statements });

      if (office.slackChannelId) {
        await notifySlack(office as typeof office & { slackChannelId: string }, month, year, result, appUrl);
      }
    } catch (e) {
      results.push({
        office: office.name,
        created: false,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return Response.json({
    month,
    year,
    offices: results.length,
    created: results.filter((r) => r.created).length,
    queued: results.filter((r) => r.statements === "queued").length,
    results,
  });
}
