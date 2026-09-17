import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { buildCostingLedger } from "@/lib/costing";
import { sliceLedger } from "@/lib/reimbursement-calc";
import { getOfficeDebtors } from "@/lib/payment-reminder";
import { formatMonthLabel } from "@/lib/date";
import { ReimbursementPeriodCard } from "@/components/reimbursement-period-card";
import { OutstandingBalancesCard } from "./outstanding-card";
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

export function OutstandingSectionFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-1 h-4 w-72" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </CardContent>
    </Card>
  );
}

// ── Async sections ───────────────────────────────────────

/**
 * Who has not paid, across every period at once.
 *
 * Kept out of `PeriodsSection` so the debt list — the cheap query — paints
 * without waiting on the costing replay the period cards need.
 */
export async function OutstandingSection({
  officeId,
  locale,
}: {
  readonly officeId: string;
  readonly locale: string;
}) {
  const debtors = await getOfficeDebtors(officeId);

  return (
    <OutstandingBalancesCard
      officeId={officeId}
      debtors={debtors.map((d) => ({
        userId: d.userId,
        name: d.name,
        email: d.email,
        image: resolveAvatarUrl(d.image),
        totals: d.totals,
        periods: d.periods.map((p) => ({
          periodId: p.periodId,
          // Named in the admin's language: this screen is theirs, unlike the
          // reminder mail, which is written in the recipient's.
          label: formatMonthLabel(p.startDate, locale),
          amount: p.amount,
          currency: p.currency,
          creditors: p.creditors,
        })),
      }))}
    />
  );
}


export async function PeriodsSection({ officeId }: { readonly officeId: string }) {
  const t = await getTranslations();

  // One replay for the whole screen, fetched alongside the periods: the ledger
  // is causal, so each period is a slice of it rather than a rebuild.
  const [periods, ledger] = await Promise.all([
    prisma.reimbursementPeriod.findMany({
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
    }),
    buildCostingLedger(officeId),
  ]);

  const periodsWithShares = await Promise.all(
    periods.map(async (period) => {
      const result = sliceLedger(ledger, period.startDate, period.endDate);

      const paidCount = period.lines.filter((l) => l.status === "PAID").length;

      return {
        period: {
          id: period.id,
          startDate: period.startDate.toISOString(),
          endDate: period.endDate.toISOString(),
          statementsSentAt: period.statementsSentAt?.toISOString() ?? null,
          lines: await Promise.all(
            period.lines.map(async (l) => ({
              id: l.id,
              fromUserName: l.fromUser.name,
              fromUserImage: resolveAvatarUrl(l.fromUser.image),
              toUserName: l.toUser.name,
              toUserImage: resolveAvatarUrl(l.toUser.image),
              amount: l.amount.toNumber(),
              status: l.status,
            })),
          ),
        },
        shares: result.shares,
        totalConsumption: result.totalConsumption,
        totalCost: result.totalCost,
        lossQty: result.lossQty,
        lossCost: result.lossCost,
        unallocatedLossCost: result.unallocatedLossCost,
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
          lossQty={p.lossQty}
          lossCost={p.lossCost}
          unallocatedLossCost={p.unallocatedLossCost}
        />
      ))}
    </div>
  );
}
