import { platform } from "@/platform";
import { BatchConflictError, commitBatch, newId, prisma } from "@/lib/prisma";
import { toCents } from "@/lib/money";
import { calculateReimbursements, type ReimbursementResult } from "@/lib/reimbursement-calc";
import { buildMonthlyBillMessage, sendSlackMessage } from "@/lib/slack";

/** The calendar month before `now`, in UTC: what the close on the 1st settles. */
export interface ClosedMonth {
  readonly month: number;
  readonly year: number;
  /** First day, UTC midnight. */
  readonly startDate: Date;
  /** Last day, UTC midnight. */
  readonly endDate: Date;
}

export function previousMonth(now: Date): ClosedMonth {
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = startDate.getUTCMonth() + 1;
  const year = startDate.getUTCFullYear();
  return { month, year, startDate, endDate: new Date(Date.UTC(year, month, 0)) };
}

/** What closing the month did for one office. */
export type OfficeClosing =
  | { readonly status: "exists" | "empty" }
  | {
      readonly status: "created";
      readonly lines: number;
      /** Whether its members' statements were handed to the job queue. */
      readonly statementsQueued: boolean;
    }
  | { readonly status: "failed"; readonly error: string };

interface ClosingOffice {
  readonly id: string;
  readonly name: string;
  readonly slackChannelId: string | null;
  readonly locale: string;
}

/** The monthly bill in the office's channel. Best effort: the period already exists. */
async function announce(office: ClosingOffice, closed: ClosedMonth, result: ReimbursementResult): Promise<void> {
  if (!office.slackChannelId) return;
  try {
    const { blocks, fallback } = await buildMonthlyBillMessage({
      officeName: office.name,
      month: closed.month,
      year: closed.year,
      totalConsumption: result.totalConsumption,
      totalCost: result.totalCost,
      consumers: result.shares.length,
      appUrl: platform.env.baseUrl(),
      officeId: office.id,
      locale: office.locale,
    });
    await sendSlackMessage(office.slackChannelId, blocks, fallback);
  } catch (error) {
    console.error(`[monthly-reimbursement] Slack announce failed for ${office.name}`, error);
  }
}

/**
 * Each member's statement is mailed by a queued job, one per office, so one
 * slow mail provider cannot hold up every other office. A failure to queue is
 * reported, not thrown: the period exists and the deliveries are recorded per
 * person, so an admin can re-send from the period card without double-billing.
 */
async function queueStatements(periodId: string): Promise<boolean> {
  try {
    await platform.jobs.enqueue({ name: "period-statements", payload: { periodId } });
    return true;
  } catch (error) {
    console.error(`[monthly-reimbursement] queueing statements of ${periodId} failed`, error);
    return false;
  }
}

async function closeOffice(office: ClosingOffice, closed: ClosedMonth): Promise<OfficeClosing> {
  const { month, year, startDate, endDate } = closed;
  const existing = await prisma.reimbursementPeriod.findUnique({
    where: { officeId_year_month: { officeId: office.id, year, month } },
    select: { id: true },
  });
  if (existing) return { status: "exists" };

  const result = await calculateReimbursements(office.id, startDate, endDate);
  if (result.totalConsumption === 0 && result.totalCost === 0) return { status: "empty" };

  // Computed above, committed in one atomic batch: the period and its lines,
  // or nothing. A concurrent close that created the period first fails the
  // batch on the (office, year, month) key, which is the "exists" outcome.
  const periodId = newId();
  try {
    await commitBatch((db) => [
      db.reimbursementPeriod.createMany({
        data: [{ id: periodId, officeId: office.id, month, year, startDate, endDate }],
      }),
      ...(result.lines.length > 0
        ? [
            db.reimbursementLine.createMany({
              data: result.lines.map((line) => ({
                periodId,
                fromUserId: line.fromUserId,
                toUserId: line.toUserId,
                amountCents: toCents(line.amount),
                currency: "CHF",
              })),
            }),
          ]
        : []),
    ]);
  } catch (error) {
    if (error instanceof BatchConflictError && error.reason === "unique") return { status: "exists" };
    throw error;
  }

  const statementsQueued = await queueStatements(periodId);
  await announce(office, closed, result);
  return { status: "created", lines: result.lines.length, statementsQueued };
}

/**
 * Closes the month before `now`: one reimbursement period per office that
 * consumed something, its members' statements queued for mailing, and the
 * bill announced in Slack. Idempotent: an office whose period exists is left
 * alone. `officeId` limits the close to one office (admin "run now").
 */
export async function closeMonthlyReimbursements(options: {
  readonly now: Date;
  readonly officeId?: string;
}): Promise<{ readonly closed: ClosedMonth; readonly offices: ReadonlyMap<string, OfficeClosing> }> {
  const closed = previousMonth(options.now);
  const offices = await prisma.office.findMany({
    where: options.officeId ? { id: options.officeId } : {},
    select: { id: true, name: true, slackChannelId: true, locale: true },
  });

  const outcomes = await Promise.all(
    offices.map(async (office): Promise<[string, OfficeClosing]> => {
      try {
        return [office.id, await closeOffice(office, closed)];
      } catch (error) {
        console.error(`[monthly-reimbursement] closing ${office.name} failed`, error);
        return [office.id, { status: "failed", error: error instanceof Error ? error.message : String(error) }];
      }
    }),
  );
  return { closed, offices: new Map(outcomes) };
}
