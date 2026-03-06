import { cache } from "react";
import { TrendingDown, TrendingUp, Scale, Eye, CupSoda, Banknote } from "lucide-react";
import { getTranslations, getLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import { UserReimbursementCard } from "@/components/user-reimbursement-card";
import { ConsumptionHistoryCard } from "@/components/consumption-history-card";
import { DataPagination } from "@/components/pagination";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 20;

function formatPeriodLabel(startDate: Date, endDate: Date) {
  const isFullMonth =
    startDate.getDate() === 1 &&
    endDate.getDate() ===
      new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate() &&
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getFullYear() === endDate.getFullYear();

  if (isFullMonth) {
    return startDate.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }

  return `${startDate.toLocaleDateString("fr-CH")} – ${endDate.toLocaleDateString("fr-CH")}`;
}

// Cached data fetcher — shared between BalanceSection and PeriodsSection
const getPeriodsData = cache(async (officeId: string, userId: string) => {
  const periods = await prisma.reimbursementPeriod.findMany({
    where: { officeId },
    orderBy: { startDate: "desc" },
    include: {
      lines: {
        where: {
          OR: [{ fromUserId: userId }, { toUserId: userId }],
        },
        include: {
          fromUser: { select: { name: true, image: true } },
          toUser: { select: { name: true, image: true } },
        },
      },
    },
  });

  const periodsWithData = await Promise.all(
    periods.map(async (period) => {
      const result = await calculateReimbursements(
        officeId,
        period.startDate,
        period.endDate,
      );

      const userShare = result.shares.find((s) => s.userId === userId);

      const userLines = await Promise.all(
        period.lines.map(async (l) => {
          const other = l.fromUserId === userId ? l.toUser : l.fromUser;
          return {
            lineId: l.id,
            direction: l.fromUserId === userId ? "pay" as const : "receive" as const,
            otherUserName: other.name,
            otherUserImage: await resolveAvatarUrl(other.image),
            amount: l.amount.toNumber(),
            status: l.status,
          };
        }),
      );

      return {
        id: period.id,
        label: formatPeriodLabel(period.startDate, period.endDate),
        qty: userShare?.qty ?? 0,
        costShare: userShare?.costShare ?? 0,
        amountPaid: userShare?.amountPaid ?? 0,
        netOwed: userShare?.netOwed ?? 0,
        lines: userLines,
      };
    }),
  );

  const totalOwed = periodsWithData
    .flatMap((p) => p.lines)
    .filter((l) => l.direction === "pay" && l.status === "PENDING")
    .reduce((sum, l) => sum + l.amount, 0);
  const totalOwedToYou = periodsWithData
    .flatMap((p) => p.lines)
    .filter((l) => l.direction === "receive" && l.status === "PENDING")
    .reduce((sum, l) => sum + l.amount, 0);
  const netBalance = totalOwedToYou - totalOwed;

  return { periodsWithData, totalOwed, totalOwedToYou, netBalance };
});

// ── Skeleton fallbacks ───────────────────────────────────

export function BalanceSectionFallback() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-1 h-7 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function PreviewSectionFallback() {
  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-1 h-4 w-56" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg bg-muted/50 p-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-5 w-12" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function HistorySectionFallback() {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function PeriodsSectionFallback() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
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

// ── Async sections ───────────────────────────────────────

interface SectionProps {
  readonly officeId: string;
  readonly userId: string;
}

export async function BalanceSection({ officeId, userId }: SectionProps) {
  const t = await getTranslations();
  const { totalOwed, totalOwedToYou, netBalance } = await getPeriodsData(officeId, userId);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardDescription>{t('reimbursements.youOweLabel')}</CardDescription>
            <TrendingDown className="size-5 text-red-500 dark:text-red-400" />
          </div>
          <CardTitle
            className={`text-2xl ${
              totalOwed > 0.01
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground"
            }`}
          >
            CHF {totalOwed.toFixed(2)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">{t('reimbursements.pendingPayments')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardDescription>{t('reimbursements.owedToYouLabel')}</CardDescription>
            <TrendingUp className="size-5 text-green-500 dark:text-green-400" />
          </div>
          <CardTitle
            className={`text-2xl ${
              totalOwedToYou > 0.01
                ? "text-green-600 dark:text-green-400"
                : "text-muted-foreground"
            }`}
          >
            CHF {totalOwedToYou.toFixed(2)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">{t('reimbursements.pendingReceipts')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardDescription>{t('reimbursements.netBalanceLabel')}</CardDescription>
            <Scale className="size-5 text-muted-foreground" />
          </div>
          <CardTitle
            className={`text-2xl ${
              netBalance > 0.01
                ? "text-green-600 dark:text-green-400"
                : netBalance < -0.01
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground"
            }`}
          >
            {netBalance > 0.01
              ? `+CHF ${netBalance.toFixed(2)}`
              : netBalance < -0.01
                ? `-CHF ${Math.abs(netBalance).toFixed(2)}`
                : "CHF 0.00"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {netBalance > 0.01
              ? t('reimbursements.inYourFavor')
              : netBalance < -0.01
                ? t('dashboard.youOwe')
                : t('reimbursements.allSettled')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export async function PreviewSection({ officeId, userId }: SectionProps) {
  const t = await getTranslations();

  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const currentMonthEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
  const currentMonthLabel = currentMonthStart.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const preview = await calculateReimbursements(
    officeId,
    currentMonthStart,
    currentMonthEnd,
  );
  const previewShare = preview.shares.find((s) => s.userId === userId);
  const hasPreviewData = preview.totalConsumption > 0 || preview.totalCost > 0;

  if (!hasPreviewData) return null;

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Eye className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">{currentMonthLabel}</CardTitle>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {t('reimbursements.preview')}
          </Badge>
        </div>
        <CardDescription>
          {t('reimbursements.estimatedBill')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CupSoda className="size-3 text-amber-500" />
              {t('reimbursements.consumed')}
            </p>
            <p className="mt-1 text-base font-semibold">
              {previewShare?.qty ?? 0}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Banknote className="size-3 text-blue-500" />
              {t('reimbursements.yourShare')}
            </p>
            <p className="mt-1 text-base font-semibold">
              CHF {(previewShare?.costShare ?? 0).toFixed(2)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">{t('reimbursements.youPaid')}</p>
            <p className="mt-1 text-base font-semibold">
              CHF {(previewShare?.amountPaid ?? 0).toFixed(2)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">{t('reimbursements.balance')}</p>
            <p
              className={`mt-1 text-base font-semibold ${
                (previewShare?.netOwed ?? 0) > 0.01
                  ? "text-red-600 dark:text-red-400"
                  : (previewShare?.netOwed ?? 0) < -0.01
                    ? "text-green-600 dark:text-green-400"
                    : "text-muted-foreground"
              }`}
            >
              {(previewShare?.netOwed ?? 0) > 0.01
                ? `CHF ${previewShare!.netOwed.toFixed(2)}`
                : (previewShare?.netOwed ?? 0) < -0.01
                  ? `-CHF ${Math.abs(previewShare!.netOwed).toFixed(2)}`
                  : "CHF 0.00"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface HistorySectionProps extends SectionProps {
  readonly page: number;
}

export async function HistorySection({ officeId, userId, page }: HistorySectionProps) {
  const locale = await getLocale();

  const [allConsumptions, consumptionCount] = await Promise.all([
    prisma.consumptionEntry.findMany({
      where: { userId, officeId },
      select: {
        id: true,
        date: true,
        source: true,
        qty: true,
        cancelledAt: true,
        createdAt: true,
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.consumptionEntry.count({ where: { userId, officeId } }),
  ]);

  return (
    <div className="space-y-3">
      <ConsumptionHistoryCard
        officeId={officeId}
        locale={locale}
        consumptions={allConsumptions.map((c) => ({
          id: c.id,
          date: c.date.toISOString(),
          createdAt: c.createdAt.toISOString(),
          source: c.source as "DAILY_REQUEST" | "MANUAL",
          qty: c.qty,
          cancelledAt: c.cancelledAt?.toISOString() ?? null,
        }))}
      />
      <DataPagination totalItems={consumptionCount} pageSize={PAGE_SIZE} />
    </div>
  );
}

export async function PeriodsSection({ officeId, userId }: SectionProps) {
  const t = await getTranslations();
  const { periodsWithData } = await getPeriodsData(officeId, userId);

  if (periodsWithData.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('reimbursements.noPeriodsCreated')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {periodsWithData.map((p, i) => (
        <UserReimbursementCard
          key={p.id}
          officeId={officeId}
          periodId={p.id}
          label={p.label}
          qty={p.qty}
          costShare={p.costShare}
          amountPaid={p.amountPaid}
          netOwed={p.netOwed}
          lines={p.lines}
          defaultExpanded={i === 0}
        />
      ))}
    </div>
  );
}
