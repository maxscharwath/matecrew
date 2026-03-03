import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import { ReimbursementPeriodCard } from "@/components/reimbursement-period-card";
import { GenerateMissingPeriodsButton } from "./generate-button";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function ReimbursementsPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

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

      const paidCount = period.lines.filter((l) => l.status === "PAID").length;

      return {
        period: {
          id: period.id,
          startDate: period.startDate.toISOString(),
          endDate: period.endDate.toISOString(),
          lines: period.lines.map((l) => ({
            id: l.id,
            fromUserName: l.fromUser.name,
            toUserName: l.toUser.name,
            amount: l.amount.toNumber(),
            status: l.status,
          })),
        },
        shares: result.shares,
        totalConsumption: result.totalConsumption,
        totalCost: result.totalCost,
        paidCount,
      };
    })
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('reimbursements.adminTitle')}</h1>
          <p className="mt-1 text-muted-foreground">
            {t('reimbursements.adminSubtitle')}
          </p>
        </div>
        <GenerateMissingPeriodsButton officeId={officeId} />
      </div>

      {periodsWithShares.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('reimbursements.noPeriodsYet')}
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
