import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import {
  ArrowRight,
  CupSoda,
  TrendingDown,
  Scale,
  CalendarDays,
  CheckCircle2,
  Clock,
  Package,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { resolveAvatarUrl } from "@/lib/storage";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { TodayConsumptionsCard } from "@/components/today-consumptions-card";
import { TakeCanButton } from "@/components/take-can-button";
import { getTodayDate } from "@/lib/date";

interface SectionProps {
  officeId: string;
  userId: string;
}

// ── Skeleton fallbacks ───────────────────────────────────

export function HeroSectionFallback() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="flex flex-col items-center justify-center p-6">
        <Skeleton className="h-12 w-40 rounded-lg" />
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-1 h-9 w-16" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-3 w-32" />
        </CardContent>
      </Card>
    </div>
  );
}

export function TodaySectionFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-44" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

export function StatsSectionFallback() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-1 h-9 w-16" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
          <Skeleton className="mt-1 h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>
    </>
  );
}

export function SettlementSectionFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-1 h-4 w-36" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-2 w-full rounded-full" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </CardContent>
    </Card>
  );
}

export function RecentRequestsFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-1 h-4 w-48" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </CardContent>
    </Card>
  );
}

// ── Async sections ───────────────────────────────────────

export async function HeroSection({ officeId }: { officeId: string }) {
  const { membership } = await requireMembership(officeId);
  const t = await getTranslations();

  const stock = await prisma.stock.findUnique({
    where: { officeId },
    select: { currentQty: true },
  });

  const stockQty = stock?.currentQty ?? 0;
  const lowStockThreshold = membership.office.lowStockThreshold;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="flex flex-col items-center justify-center p-6">
        <TakeCanButton officeId={officeId} />
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Package className="size-4 text-muted-foreground" />
            <CardDescription>{t('dashboard.stockLevel')}</CardDescription>
          </div>
          <CardTitle className={`text-3xl ${stockQty <= lowStockThreshold ? "text-amber-600 dark:text-amber-400" : ""}`}>
            {stockQty}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {stockQty <= lowStockThreshold
              ? t('dashboard.stockLow')
              : t('dashboard.stockOk')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export async function TodaySection({ officeId, userId }: SectionProps) {
  const today = getTodayDate();

  const todayConsumptions = await prisma.consumptionEntry.findMany({
    where: { userId, officeId, date: today },
    select: {
      id: true,
      source: true,
      qty: true,
      cancelledAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <TodayConsumptionsCard
      officeId={officeId}
      consumptions={todayConsumptions.map((c) => ({
        ...c,
        cancelledAt: c.cancelledAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      }))}
    />
  );
}

export async function StatsAndFinancialsSection({ officeId, userId }: SectionProps) {
  const t = await getTranslations();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));

  const [
    totalConsumed,
    thisMonthConsumed,
    totalOfficeConsumption,
    totalPurchaseCost,
    userPaidTotal,
    monthBatches,
  ] = await Promise.all([
    prisma.consumptionEntry.aggregate({
      where: { userId, officeId, cancelledAt: null },
      _sum: { qty: true },
    }),
    prisma.consumptionEntry.aggregate({
      where: {
        userId,
        officeId,
        date: { gte: monthStart, lt: monthEnd },
        cancelledAt: null,
      },
      _sum: { qty: true },
    }),
    prisma.consumptionEntry.aggregate({
      where: { officeId, date: { gte: monthStart, lt: monthEnd }, cancelledAt: null },
      _sum: { qty: true },
    }),
    prisma.purchaseBatch.aggregate({
      where: { officeId, purchasedAt: { gte: monthStart, lt: monthEnd } },
      _sum: { totalPrice: true },
    }),
    prisma.purchaseBatch.aggregate({
      where: {
        officeId,
        paidByUserId: userId,
        purchasedAt: { gte: monthStart, lt: monthEnd },
      },
      _sum: { totalPrice: true },
    }),
    prisma.purchaseBatch.findMany({
      where: { officeId, purchasedAt: { gte: monthStart, lt: monthEnd } },
      select: {
        paidByUserId: true,
        totalPrice: true,
        paidBy: { select: { id: true, name: true, image: true } },
      },
    }),
  ]);

  const userMonthQty = thisMonthConsumed._sum.qty ?? 0;
  const totalQty = totalOfficeConsumption._sum.qty ?? 0;
  const totalCost = Number(totalPurchaseCost._sum.totalPrice ?? 0);
  const userPaid = Number(userPaidTotal._sum.totalPrice ?? 0);
  const userShare =
    totalQty > 0
      ? Math.round(((userMonthQty / totalQty) * totalCost) * 100) / 100
      : 0;
  const netOwed = Math.round((userShare - userPaid) * 100) / 100;
  const hasPurchaseData = totalCost > 0;

  const payerTotals = new Map<string, { name: string; image: string | null; total: number }>();
  for (const b of monthBatches) {
    if (b.paidByUserId === userId) continue;
    const existing = payerTotals.get(b.paidByUserId);
    const batchTotal = b.totalPrice.toNumber();
    const userShareOfBatch =
      totalQty > 0 ? (userMonthQty / totalQty) * batchTotal : 0;
    if (existing) {
      existing.total += userShareOfBatch;
    } else {
      payerTotals.set(b.paidByUserId, {
        name: b.paidBy.name,
        image: b.paidBy.image,
        total: userShareOfBatch,
      });
    }
  }

  const owesTo = await Promise.all(
    [...payerTotals.values()]
      .filter((p) => p.total > 0.01)
      .sort((a, b) => b.total - a.total)
      .map(async (p) => ({
        name: p.name,
        image: resolveAvatarUrl(p.image),
        amount: Math.round(p.total * 100) / 100,
      })),
  );

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>{t('dashboard.thisMonth')}</CardDescription>
              <CupSoda className="size-4 text-amber-500" />
            </div>
            <CardTitle className="text-3xl">{userMonthQty}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{t('dashboard.matesConsumed')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>{t('dashboard.allTime')}</CardDescription>
              <CalendarDays className="size-4 text-muted-foreground" />
            </div>
            <CardTitle className="text-3xl">
              {totalConsumed._sum.qty ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{t('dashboard.matesConsumed')}</p>
          </CardContent>
        </Card>
        {hasPurchaseData && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription>{t('dashboard.yourShareEstimate')}</CardDescription>
                  <TrendingDown className="size-4 text-red-500 dark:text-red-400" />
                </div>
                <CardTitle className="text-2xl">
                  CHF {userShare.toFixed(2)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {t('dashboard.currentMonthBasedOnConsumption')}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription>{t('dashboard.netBalanceEstimate')}</CardDescription>
                  <Scale className="size-4 text-muted-foreground" />
                </div>
                <CardTitle
                  className={`text-2xl ${
                    netOwed > 0
                      ? "text-red-600 dark:text-red-400"
                      : netOwed < 0
                        ? "text-green-600 dark:text-green-400"
                        : ""
                  }`}
                >
                  {netOwed > 0
                    ? `CHF ${netOwed.toFixed(2)}`
                    : netOwed < 0
                      ? `-CHF ${Math.abs(netOwed).toFixed(2)}`
                      : "CHF 0.00"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {netOwed > 0
                    ? t('dashboard.youOwe')
                    : netOwed < 0
                      ? t('dashboard.youAreOwed')
                      : t('common.settled')}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {owesTo.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.youOweTitle')}</CardTitle>
            <CardDescription>
              {t('dashboard.breakdownDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {owesTo.map((entry) => (
                <div
                  key={entry.name}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Avatar size="sm">
                      <AvatarImage src={entry.image} alt={entry.name} />
                      <AvatarFallback>{entry.name.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{entry.name}</span>
                  </div>
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">
                    CHF {entry.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function formatPeriodLabel(startDate: Date, endDate: Date, locale: string) {
  const isFullMonth =
    startDate.getDate() === 1 &&
    endDate.getDate() ===
      new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate() &&
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getFullYear() === endDate.getFullYear();

  if (isFullMonth) {
    return startDate.toLocaleDateString(locale, {
      month: "long",
      year: "numeric",
    });
  }

  return `${startDate.toLocaleDateString(locale)} – ${endDate.toLocaleDateString(locale)}`;
}

export async function SettlementSection({ officeId, userId }: SectionProps) {
  const t = await getTranslations();
  const locale = await getLocale();

  const latestPeriod = await prisma.reimbursementPeriod.findFirst({
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

  if (!latestPeriod) return null;

  const periodLabel = formatPeriodLabel(latestPeriod.startDate, latestPeriod.endDate, locale);

  const periodLines = await Promise.all(
    latestPeriod.lines.map(async (l) => {
      const other = l.fromUserId === userId ? l.toUser : l.fromUser;
      return {
        id: l.id,
        direction: l.fromUserId === userId ? "pay" as const : "receive" as const,
        otherUserName: other.name,
        otherUserImage: resolveAvatarUrl(other.image),
        amount: l.amount.toNumber(),
        status: l.status,
      };
    }),
  );

  const periodPaidCount = periodLines.filter((l) => l.status === "PAID").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.latestSettlement', { period: periodLabel })}</CardTitle>
        <CardDescription>
          {t('dashboard.finalizedPeriod')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {periodLines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('dashboard.noPaymentsInPeriod')}
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('dashboard.paidCount', { paid: periodPaidCount, total: periodLines.length })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {Math.round((periodPaidCount / periodLines.length) * 100)}%
                </span>
              </div>
              <Progress value={(periodPaidCount / periodLines.length) * 100} />
            </div>
            <div className="space-y-2">
              {periodLines.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Avatar size="sm">
                      <AvatarImage src={l.otherUserImage} alt={l.otherUserName} />
                      <AvatarFallback>{l.otherUserName.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">
                      {l.direction === "pay"
                        ? t('dashboard.youPayUser', { name: l.otherUserName })
                        : t('dashboard.userPaysYou', { name: l.otherUserName })}
                    </span>
                    <Badge
                      variant={l.status === "PAID" ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {l.status === "PAID" ? t('common.paid') : t('common.pending')}
                    </Badge>
                  </div>
                  <span
                    className={`text-sm font-medium ${
                      l.status === "PAID"
                        ? "text-muted-foreground line-through"
                        : l.direction === "pay"
                          ? "text-red-600 dark:text-red-400"
                          : "text-green-600 dark:text-green-400"
                    }`}
                  >
                    CHF {l.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        <Link
          href={`/org/${officeId}/reimbursements`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t('dashboard.viewAllPeriods')}
          <ArrowRight className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

export async function RecentRequestsSection({ officeId, userId }: SectionProps) {
  const t = await getTranslations();
  const locale = await getLocale();

  const recentRequests = await prisma.dailyRequest.findMany({
    where: { userId, officeId },
    orderBy: { date: "desc" },
    take: 10,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.recentRequests')}</CardTitle>
        <CardDescription>{t('dashboard.lastRequests')}</CardDescription>
      </CardHeader>
      <CardContent>
        {recentRequests.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CupSoda className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {t('dashboard.noRequestsYet')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentRequests.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  {req.status === "SERVED" ? (
                    <CheckCircle2 className="size-4 text-green-500" />
                  ) : (
                    <Clock className="size-4 text-amber-500" />
                  )}
                  <span className="text-sm font-medium">
                    {new Date(req.date).toLocaleDateString(locale, { timeZone: "UTC" })}
                  </span>
                </div>
                <Badge
                  variant={req.status === "SERVED" ? "default" : "secondary"}
                >
                  {req.status === "SERVED" ? t('dashboard.served') : t('dashboard.requested')}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
