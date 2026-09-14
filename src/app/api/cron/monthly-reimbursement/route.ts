import { prisma } from "@/lib/prisma";
import { verifyQStashSignature } from "@/lib/qstash";
import { calculateReimbursements, type ReimbursementResult } from "@/lib/reimbursement-calc";
import { sendSlackMessage, buildMonthlyBillMessage } from "@/lib/slack";
import { sendPeriodStatements } from "@/lib/settlement-mail";

// Rendering and mailing one PDF per member is the slow part of this route;
// the default serverless window is not built for it.
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
    /** Statements emailed for this office's new period. */
    mailed?: number;
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

      // Each member gets their own bill by mail. Best-effort: the period is
      // already written, and a mail server having a bad day must not make the
      // cron look like it failed to close the month.
      let mailed = 0;
      try {
        const statements = await sendPeriodStatements(period.id);
        if (statements.kind === "sent") mailed = statements.sent;
      } catch {
        // Reported as `mailed: 0`; an admin can re-send from the period card.
      }

      results.push({ office: office.name, created: true, mailed });

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
    mailed: results.reduce((sum, r) => sum + (r.mailed ?? 0), 0),
    results,
  });
}
