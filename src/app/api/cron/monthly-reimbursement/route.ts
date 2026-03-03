import { prisma } from "@/lib/prisma";
import { verifyQStashSignature } from "@/lib/qstash";
import { calculateReimbursements } from "@/lib/reimbursement-calc";

/**
 * Monthly reimbursement cron — triggered by Upstash QStash on the 1st of each month.
 * Generates reimbursement periods for the previous month across all offices.
 */
export async function POST(request: Request) {
  if (!(await verifyQStashSignature(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = prevMonth.getMonth() + 1;
  const year = prevMonth.getFullYear();
  const startDate = prevMonth;
  const endDate = new Date(year, month, 0);

  const offices = await prisma.office.findMany({
    select: { id: true, name: true },
  });

  const results: { office: string; created: boolean; error?: string }[] = [];

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

      await prisma.reimbursementPeriod.create({
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

      results.push({ office: office.name, created: true });
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
    results,
  });
}
