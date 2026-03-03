import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import { CreatePeriodForm } from "@/components/create-period-form";
import { ReimbursementPeriodCard } from "@/components/reimbursement-period-card";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function ReimbursementsPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");

  const periods = await prisma.reimbursementPeriod.findMany({
    where: { officeId },
    orderBy: { startDate: "desc" },
    include: {
      lines: {
        include: {
          fromUser: { select: { name: true } },
          toUser: { select: { name: true } },
        },
      },
    },
  });

  // Calculate shares for each period
  const periodsWithShares = await Promise.all(
    periods.map(async (period) => {
      const result = await calculateReimbursements(
        officeId,
        period.startDate,
        period.endDate
      );

      return {
        period: {
          id: period.id,
          startDate: period.startDate.toISOString(),
          endDate: period.endDate.toISOString(),
          closedAt: period.closedAt?.toISOString() ?? null,
          lines: period.lines.map((l) => ({
            id: l.id,
            fromUserName: l.fromUser.name,
            toUserName: l.toUser.name,
            amount: l.amount.toNumber(),
          })),
        },
        shares: result.shares,
        totalConsumption: result.totalConsumption,
        totalCost: result.totalCost,
      };
    })
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-bold">Reimbursements</h1>
        <p className="mt-1 text-muted-foreground">
          Create periods, calculate who owes whom, and export reports.
        </p>
      </div>

      <CreatePeriodForm officeId={officeId} />

      {periodsWithShares.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No reimbursement periods yet.
        </p>
      ) : (
        <div className="space-y-4">
          {periodsWithShares.map((p) => (
            <ReimbursementPeriodCard
              key={p.period.id}
              officeId={officeId}
              period={p.period}
              shares={p.shares}
              totalConsumption={p.totalConsumption}
              totalCost={p.totalCost}
            />
          ))}
        </div>
      )}
    </div>
  );
}
