import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import {
  ArrowRight,
  CupSoda,
  TrendingDown,
  TrendingUp,
  Minus,
  Scale,
  CalendarDays,
  Flame,
  Trophy,
  Clock,
  Package,
  type LucideIcon,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { fromCents } from "@/lib/money";
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
import { MateCrewLogo } from "@/components/matecrew-logo";
import { TakeCanButton } from "@/components/take-can-button";
import { Device3D } from "@/components/device-3d";
import {
  MateActivityHeatmap,
  type HeatmapCell,
} from "@/components/mate-activity-heatmap";
import { getTodayDate } from "@/lib/date";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import { getActiveItems } from "@/lib/items";
import { effectiveLowStockThreshold } from "@/lib/stock";
import { cn } from "@/lib/utils";
import { memberTerminal } from "@/lib/device/member-terminal";

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

export function PersonalStatsFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-1 h-4 w-32" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {["total", "current", "longest", "last"].map((k) => (
            <Skeleton key={k} className="h-19 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-28 w-full rounded-md" />
      </CardContent>
    </Card>
  );
}

// ── Async sections ───────────────────────────────────────

export async function HeroSection({ officeId }: { officeId: string }) {
  const { membership } = await requireMembership(officeId);
  const t = await getTranslations();

  const [stockAgg, items] = await Promise.all([
    prisma.stock.aggregate({
      where: { officeId },
      _sum: { currentQty: true },
    }),
    getActiveItems(officeId),
  ]);

  const stockQty = stockAgg._sum.currentQty ?? 0;
  // A shelf is low as soon as one item is: the office total hides an item that
  // has run out behind the pile of whatever sells less well.
  const stockLow = items.some(
    (i) =>
      i.stockQty <=
      effectiveLowStockThreshold(
        i.lowStockThreshold,
        membership.office.lowStockThreshold,
      ),
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="flex flex-col items-center justify-center gap-4 p-6">
        {/* The mark stands in for the thing being taken, above the button that
            takes it. A flat tile rather than the 3D can: the dashboard is the
            first screen of every session and does not need a WebGL renderer to
            show a button. */}
        <div className="brand-gradient flex size-28 items-center justify-center rounded-3xl text-white shadow-sm">
          <MateCrewLogo className="size-14" />
        </div>
        <TakeCanButton officeId={officeId} items={items} />
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Package className="size-4 text-muted-foreground" />
            <CardDescription>{t('dashboard.stockLevel')}</CardDescription>
          </div>
          <CardTitle className={`text-3xl ${stockLow ? "text-amber-600 dark:text-amber-400" : ""}`}>
            {stockQty}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {stockLow ? t('dashboard.stockLow') : t('dashboard.stockOk')}
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
      item: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <TodayConsumptionsCard
      officeId={officeId}
      consumptions={todayConsumptions.map((c) => ({
        id: c.id,
        source: c.source,
        qty: c.qty,
        itemName: c.item.name,
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
  const monthEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));

  const [totalConsumed, thisMonthConsumed, preview] = await Promise.all([
    prisma.consumptionEntry.aggregate({
      where: { userId, officeId, cancelledAt: null },
      _sum: { qty: true },
    }),
    prisma.consumptionEntry.aggregate({
      where: {
        userId,
        officeId,
        date: { gte: monthStart, lte: monthEnd },
        cancelledAt: null,
      },
      _sum: { qty: true },
    }),
    calculateReimbursements(officeId, monthStart, monthEnd),
  ]);

  const userMonthQty = thisMonthConsumed._sum.qty ?? 0;
  const share = preview.shares.find((s) => s.userId === userId);
  const userShare = share?.costShare ?? 0;
  const netOwed = share?.netOwed ?? 0;
  const hasPurchaseData = preview.avgUnitPrice > 0;
  // Price of the mix of items this user actually drank. Their share of the
  // missing cans is excluded — it is a loss, not the price of a can.
  const userAvgPrice =
    share && share.qty > 0
      ? (share.costShare - share.lossShare) / share.qty
      : preview.avgUnitPrice;

  const owedLines = preview.lines
    .filter((l) => l.fromUserId === userId)
    .sort((a, b) => b.amount - a.amount);
  const creditors = owedLines.length
    ? await prisma.user.findMany({
        where: { id: { in: owedLines.map((l) => l.toUserId) } },
        select: { id: true, image: true },
      })
    : [];
  const creditorImages = new Map(creditors.map((u) => [u.id, u.image]));
  const owesTo = owedLines.map((l) => ({
    name: l.toUserName,
    image: resolveAvatarUrl(creditorImages.get(l.toUserId)),
    amount: l.amount,
  }));

  let netClass = "";
  let netAmount = "CHF 0.00";
  let netHint = t('common.settled');
  if (netOwed > 0) {
    netClass = "text-red-600 dark:text-red-400";
    netAmount = `CHF ${netOwed.toFixed(2)}`;
    netHint = t('dashboard.youOwe');
  } else if (netOwed < 0) {
    netClass = "text-green-600 dark:text-green-400";
    netAmount = `-CHF ${Math.abs(netOwed).toFixed(2)}`;
    netHint = t('dashboard.youAreOwed');
  }

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
                  {t('dashboard.shareFormula', {
                    qty: share?.qty ?? 0,
                    price: userAvgPrice.toFixed(2),
                  })}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription>{t('dashboard.netBalanceEstimate')}</CardDescription>
                  <Scale className="size-4 text-muted-foreground" />
                </div>
                <CardTitle className={`text-2xl ${netClass}`}>
                  {netAmount}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{netHint}</p>
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
        amount: fromCents(l.amountCents),
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
                  <span className={`text-sm font-medium ${lineAmountClass(l)}`}>
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

/** Paid lines fade out; open ones are red to pay and green to receive. */
function lineAmountClass(line: { status: string; direction: "pay" | "receive" }): string {
  if (line.status === "PAID") return "text-muted-foreground line-through";
  return line.direction === "pay"
    ? "text-red-600 dark:text-red-400"
    : "text-green-600 dark:text-green-400";
}

function bucketFor(qty: number): HeatmapCell["bucket"] {
  if (qty <= 0) return 0;
  if (qty === 1) return 1;
  if (qty === 2) return 2;
  if (qty === 3) return 3;
  return 4;
}

function startOfWeekMon(date: Date): Date {
  const dow = (date.getUTCDay() + 6) % 7;
  const d = new Date(date);
  d.setUTCDate(date.getUTCDate() - dow);
  return d;
}

function formatRelativeShort(from: Date, now: Date, locale: string): string {
  const diffMs = now.getTime() - from.getTime();
  const minutes = Math.round(diffMs / 60_000);
  const hours = Math.round(diffMs / 3_600_000);
  const days = Math.round(diffMs / 86_400_000);
  const months = Math.round(days / 30);
  const years = Math.round(days / 365);
  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "short",
  });
  if (Math.abs(years) >= 1) return rtf.format(-years, "year");
  if (Math.abs(months) >= 1) return rtf.format(-months, "month");
  if (Math.abs(days) >= 1) return rtf.format(-days, "day");
  if (Math.abs(hours) >= 1) return rtf.format(-hours, "hour");
  if (Math.abs(minutes) >= 1) return rtf.format(-minutes, "minute");
  return rtf.format(0, "minute");
}

export async function PersonalStatsSection({ officeId, userId }: SectionProps) {
  const t = await getTranslations();
  const locale = await getLocale();

  const today = getTodayDate();
  const currentWeekMonday = startOfWeekMon(today);
  const gridStart = new Date(currentWeekMonday);
  gridStart.setUTCDate(currentWeekMonday.getUTCDate() - 52 * 7);

  const [entries, lastEntry] = await Promise.all([
    prisma.consumptionEntry.findMany({
      where: {
        userId,
        officeId,
        date: { gte: gridStart },
        cancelledAt: null,
      },
      select: { date: true, qty: true },
    }),
    prisma.consumptionEntry.findFirst({
      where: { userId, officeId, cancelledAt: null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const qtyByDate = new Map<string, number>();
  for (const e of entries) {
    const key = e.date.toISOString().slice(0, 10);
    qtyByDate.set(key, (qtyByDate.get(key) ?? 0) + e.qty);
  }

  const { weeks, monthLabels, dailyOrdered } = buildHeatmap(
    gridStart,
    today,
    qtyByDate,
    locale,
    (qty) => t("dashboard.matesUnit", { count: qty }),
  );

  const totalCups = dailyOrdered.reduce((s, d) => s + d.qty, 0);
  const avgPerWeek = Math.round((totalCups / 52) * 10) / 10;

  const weekActive = weeks.map((week) =>
    week.some((cell) => cell.date !== null && cell.qty > 0),
  );

  const { currentStreak, longestStreak } = weekStreaks(weekActive);
  const { busiestDow, busiestDayQty } = busiestWeekday(dailyOrdered);
  const trendPct = weeklyTrendPct(dailyOrdered);

  const now = new Date();
  const lastMateRelative = lastEntry
    ? formatRelativeShort(lastEntry.createdAt, now, locale)
    : t("dashboard.lastMateNever");

  const trail = weeks.slice(-7).map((week) => {
    const firstReal = week.find((c) => c.date !== null);
    return {
      key: firstReal?.date ?? `pad-${crypto.randomUUID()}`,
      active: week.some((c) => c.date !== null && c.qty > 0),
    };
  });

  // Mon..Sun reference date for short weekday labels: a Monday in 2024
  const monRef = new Date(Date.UTC(2024, 0, 1));
  const weekdayLabels = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = new Date(monRef);
    d.setUTCDate(monRef.getUTCDate() + i);
    return d.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });
  }) as unknown as readonly [string, string, string, string, string, string, string];

  const busiestDayName = (() => {
    const d = new Date(monRef);
    d.setUTCDate(monRef.getUTCDate() + busiestDow);
    return d.toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" });
  })();

  const hasActivity = totalCups > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.mateActivity")}</CardTitle>
        <CardDescription>{t("dashboard.mateActivityDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasActivity ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CupSoda className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {t("dashboard.noMateActivity")}
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                icon={<CupSoda className="size-4" />}
                accent="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                label={t("dashboard.totalCups")}
                value={String(totalCups)}
                unit={t("dashboard.matesShort", { count: totalCups })}
                hint={
                  busiestDayQty > 0
                    ? t("dashboard.totalCupsHintWithDay", {
                        avg: avgPerWeek,
                        day: busiestDayName,
                      })
                    : t("dashboard.avgPerWeekHint", { avg: avgPerWeek })
                }
              />
              <StatTile
                icon={<Flame className="size-4" />}
                accent="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
                label={t("dashboard.currentStreak")}
                value={String(currentStreak)}
                unit={t("dashboard.weeksShort")}
                trail={<StreakTrail trail={trail} />}
              />
              <StatTile
                icon={<Trophy className="size-4" />}
                accent="bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300"
                label={t("dashboard.longestStreak")}
                value={String(longestStreak)}
                unit={t("dashboard.weeksShort")}
              />
              <StatTile
                icon={<Clock className="size-4" />}
                accent="bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300"
                label={t("dashboard.lastMate")}
                value={lastMateRelative}
              />
            </div>

            {trendPct !== null && <TrendPill pct={trendPct} t={t} />}

            <MateActivityHeatmap
              weeks={weeks}
              monthLabels={monthLabels}
              weekdayLabels={weekdayLabels}
              legendLess={t("dashboard.legendLess")}
              legendMore={t("dashboard.legendMore")}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface DayQty {
  date: Date;
  qty: number;
  key: string;
}

function heatmapCell(
  day: DayQty,
  locale: string,
  countLabel: (qty: number) => string,
): HeatmapCell {
  const dateLabel = day.date.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return {
    date: day.key,
    qty: day.qty,
    bucket: bucketFor(day.qty),
    countLabel: countLabel(day.qty),
    dateLabel,
  };
}

/** The month's short name over the column holding its first days; null elsewhere. */
function monthLabelFor(
  firstDay: Date | null,
  lastMonthLabelled: number,
  locale: string,
): string | null {
  if (!firstDay) return null;
  if (firstDay.getUTCMonth() === lastMonthLabelled || firstDay.getUTCDate() > 7) {
    return null;
  }
  return firstDay.toLocaleDateString(locale, {
    month: "short",
    timeZone: "UTC",
  });
}

/** 53 week columns from `gridStart`, the days after `today` left blank. */
function buildHeatmap(
  gridStart: Date,
  today: Date,
  qtyByDate: ReadonlyMap<string, number>,
  locale: string,
  countLabel: (qty: number) => string,
) {
  const weeks: HeatmapCell[][] = [];
  const monthLabels: (string | null)[] = [];
  const dailyOrdered: DayQty[] = [];

  let lastMonthLabelled = -1;

  for (let w = 0; w < 53; w++) {
    const week: HeatmapCell[] = [];
    let firstRealDayThisCol: Date | null = null;
    for (let d = 0; d < 7; d++) {
      const dt = new Date(gridStart);
      dt.setUTCDate(gridStart.getUTCDate() + w * 7 + d);
      if (dt.getTime() > today.getTime()) {
        week.push({ date: null, qty: 0, bucket: 0 });
      } else {
        const key = dt.toISOString().slice(0, 10);
        const day = { date: dt, qty: qtyByDate.get(key) ?? 0, key };
        week.push(heatmapCell(day, locale, countLabel));
        dailyOrdered.push(day);
        firstRealDayThisCol ??= dt;
      }
    }
    weeks.push(week);

    const monthLabel = monthLabelFor(firstRealDayThisCol, lastMonthLabelled, locale);
    monthLabels.push(monthLabel);
    if (monthLabel !== null && firstRealDayThisCol) {
      lastMonthLabelled = firstRealDayThisCol.getUTCMonth();
    }
  }

  return { weeks, monthLabels, dailyOrdered };
}

/** Consecutive active weeks up to now, and the longest run in the grid. */
function weekStreaks(weekActive: readonly boolean[]) {
  let currentStreak = 0;
  for (let i = weekActive.length - 1; i >= 0; i--) {
    if (weekActive[i]) {
      currentStreak++;
    } else if (i === weekActive.length - 1) {
      // Current week: empty so far, but the week isn't over — don't break the streak yet.
      continue;
    } else {
      break;
    }
  }

  let longestStreak = 0;
  let weekRun = 0;
  for (const active of weekActive) {
    if (active) {
      weekRun++;
      if (weekRun > longestStreak) longestStreak = weekRun;
    } else {
      weekRun = 0;
    }
  }

  return { currentStreak, longestStreak };
}

/** The weekday (0 = Monday) with the most mates, and that total. */
function busiestWeekday(days: readonly DayQty[]) {
  const byWeekday: number[] = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) {
    const dow = (d.date.getUTCDay() + 6) % 7;
    byWeekday[dow] += d.qty;
  }
  let busiestDow = 0;
  for (let i = 1; i < 7; i++) {
    if (byWeekday[i] > byWeekday[busiestDow]) busiestDow = i;
  }
  return { busiestDow, busiestDayQty: byWeekday[busiestDow] };
}

/** This week against the three before it, in percent; null with nothing to compare. */
function weeklyTrendPct(days: readonly DayQty[]): number | null {
  const thisWeek = days.slice(-7).reduce((s, d) => s + d.qty, 0);
  const prior3wDays = days.slice(-28, -7);
  const prior3wTotal = prior3wDays.reduce((s, d) => s + d.qty, 0);
  const priorWeeklyAvg = prior3wDays.length > 0 ? prior3wTotal / 3 : 0;

  if (priorWeeklyAvg <= 0) return null;
  return Math.round(((thisWeek - priorWeeklyAvg) / priorWeeklyAvg) * 100);
}

function TrendPill({
  pct,
  t,
}: {
  pct: number;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  let Icon: LucideIcon;
  let label: string;
  if (pct > 0) {
    Icon = TrendingUp;
    label = t("dashboard.trendUp", { pct });
  } else if (pct < 0) {
    Icon = TrendingDown;
    label = t("dashboard.trendDown", { pct: Math.abs(pct) });
  } else {
    Icon = Minus;
    label = t("dashboard.trendFlat");
  }
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
        pct > 0 &&
          "border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300",
        pct < 0 &&
          "border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300",
        pct === 0 && "border-border bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
    </div>
  );
}

function StatTile({
  icon,
  accent,
  label,
  value,
  unit,
  hint,
  trail,
}: {
  icon: React.ReactNode;
  accent: string;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  trail?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          accent,
        )}
      >
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <p className="mt-0.5 truncate text-xl font-semibold leading-snug tabular-nums">
          {value}
          {unit && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              {unit}
            </span>
          )}
        </p>
        {trail && <div className="mt-1.5">{trail}</div>}
        {hint && (
          <span className="mt-1 truncate text-[11px] text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

function StreakTrail({
  trail,
}: {
  trail: { key: string; active: boolean }[];
}) {
  return (
    <div className="flex gap-1">
      {trail.map((w) => (
        <div
          key={w.key}
          className={cn(
            "size-1.5 rounded-full",
            w.active ? "bg-orange-500 dark:bg-orange-400" : "bg-muted-foreground/25",
          )}
        />
      ))}
    </div>
  );
}

/**
 * The office's terminal in 3D, its screen drawn by the firmware from the office's real stock. Last on
 * the page, and its WebGL only loads once it is scrolled near (Device3D): the hero keeps its flat tile.
 * Offices without a terminal do not get one.
 */
export async function TerminalSection({ officeId, userId }: SectionProps) {
  const office = await memberTerminal(officeId, userId);
  if (!office) return null;
  const t = await getTranslations();
  return (
    <Card className="gap-0 overflow-hidden pb-0">
      <CardHeader>
        <CardTitle>{t('dashboard.terminal3d.title')}</CardTitle>
        <CardDescription>{t('dashboard.terminal3d.subtitle')}</CardDescription>
      </CardHeader>
      <Device3D className="h-[420px] sm:h-[480px]" office={office} />
    </Card>
  );
}
