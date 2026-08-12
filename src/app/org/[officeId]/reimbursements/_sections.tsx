import { cache } from "react";
import { Eye, CupSoda, Banknote, CircleCheckBig, Wallet } from "lucide-react";
import { getTranslations, getLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import { UserReimbursementCard } from "@/components/user-reimbursement-card";
import { PaymentLineRow } from "@/components/payment-line-row";
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

// Cached data fetcher — shared between PendingPaymentsSection and PeriodsSection
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
            otherUserImage: resolveAvatarUrl(other.image),
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

export function PendingPaymentsSectionFallback() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-1 h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </CardContent>
    </Card>
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

/// Every unsettled line across every period, lifted to the top of the page.
/// Buried at the bottom inside collapsed period cards, these were easy to miss
/// entirely — and they are the only rows on this page you can act on.
export async function PendingPaymentsSection({ officeId, userId }: SectionProps) {
  const t = await getTranslations("reimbursements");
  const { periodsWithData } = await getPeriodsData(officeId, userId);

  const pending = periodsWithData.flatMap((p) =>
    p.lines
      .filter((l) => l.status === "PENDING")
      .map((l) => ({ line: l, periodLabel: p.label })),
  );

  if (pending.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <CircleCheckBig className="size-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">{t("allSettledTitle")}</CardTitle>
              <CardDescription>{t("allSettledDescription")}</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }

  const toPay = pending.filter((p) => p.line.direction === "pay");
  const toReceive = pending.filter((p) => p.line.direction === "receive");
  const owedTotal = toPay.reduce((sum, p) => sum + p.line.amount, 0);
  const owedToYouTotal = toReceive.reduce((sum, p) => sum + p.line.amount, 0);
  const netBalance = owedToYouTotal - owedTotal;

  return (
    <Card
      className={
        toPay.length > 0
          ? "border-red-200 dark:border-red-900"
          : "border-emerald-200 dark:border-emerald-900"
      }
    >
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wallet className="size-5 text-muted-foreground" />
            <CardTitle className="text-base">
              {t("pendingPaymentsTitle")}
            </CardTitle>
          </div>
          <Badge variant={toPay.length > 0 ? "destructive" : "secondary"}>
            {t("pendingCount", { count: pending.length })}
          </Badge>
        </div>
        {/* The former three balance cards, folded in — they showed exactly
            these numbers again, one screenful lower. */}
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {t("youOweLabel")}
            </p>
            <p className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400">
              CHF {owedTotal.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              {t("owedToYouLabel")}
            </p>
            <p className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              CHF {owedToYouTotal.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              {t("netBalanceLabel")}
            </p>
            <p
              className={`text-xl font-bold tabular-nums ${
                netBalance > 0.01
                  ? "text-emerald-600 dark:text-emerald-400"
                  : netBalance < -0.01
                    ? "text-red-600 dark:text-red-400"
                    : "text-muted-foreground"
              }`}
            >
              {netBalance < -0.01 ? "-" : netBalance > 0.01 ? "+" : ""}CHF{" "}
              {Math.abs(netBalance).toFixed(2)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {toPay.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("toPayGroup")}
            </p>
            {toPay.map(({ line, periodLabel }) => (
              <PaymentLineRow
                key={line.lineId}
                officeId={officeId}
                line={line}
                periodLabel={periodLabel}
              />
            ))}
          </div>
        )}
        {toReceive.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("toReceiveGroup")}
            </p>
            {toReceive.map(({ line, periodLabel }) => (
              <PaymentLineRow
                key={line.lineId}
                officeId={officeId}
                line={line}
                periodLabel={periodLabel}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
          lines={p.lines}
          // Open anything still owing, so nothing actionable hides behind a
          // collapsed header; otherwise just the newest period.
          defaultExpanded={i === 0 || p.lines.some((l) => l.status === "PENDING")}
        />
      ))}
    </div>
  );
}
