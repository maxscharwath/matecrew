import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import { ReimbursementPeriodCard } from "@/components/reimbursement-period-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslations } from "next-intl/server";

// ── Skeleton fallback ────────────────────────────────────

export function PeriodsSectionFallback() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-1 h-4 w-52" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 3 }).map((_, j) => (
              <Skeleton key={j} className="h-10 w-full rounded-md" />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Async section ────────────────────────────────────────

export async function PeriodsSection({ officeId }: { readonly officeId: string }) {
  const t = await getTranslations();

  const periods = await prisma.reimbursementPeriod.findMany({
    where: { officeId },
    orderBy: { startDate: "desc" },
    include: {
      lines: {
        include: {
          fromUser: { select: { name: true, image: true } },
          toUser: { select: { name: true, image: true } },
        },
      },
    },
  });

  const periodsWithShares = await Promise.all(
    periods.map(async (period) => {
      const result = await calculateReimbursements(
        officeId,
        period.startDate,
        period.endDate,
      );

      const paidCount = period.lines.filter((l) => l.status === "PAID").length;

      return {
        period: {
          id: period.id,
          startDate: period.startDate.toISOString(),
          endDate: period.endDate.toISOString(),
          lines: await Promise.all(
            period.lines.map(async (l) => ({
              id: l.id,
              fromUserName: l.fromUser.name,
              fromUserImage: await resolveAvatarUrl(l.fromUser.image),
              toUserName: l.toUser.name,
              toUserImage: await resolveAvatarUrl(l.toUser.image),
              amount: l.amount.toNumber(),
              status: l.status,
            })),
          ),
        },
        shares: result.shares,
        totalConsumption: result.totalConsumption,
        totalCost: result.totalCost,
        paidCount,
      };
    })
  );

  if (periodsWithShares.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('reimbursements.noPeriodsYet')}
      </p>
    );
  }

  return (
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
  );
}
