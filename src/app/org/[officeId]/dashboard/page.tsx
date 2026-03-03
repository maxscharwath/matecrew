import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { requireMembership } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/r2-helpers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  readonly params: Promise<{ officeId: string }>;
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

export default async function DashboardPage({ params }: Props) {
  const { officeId } = await params;
  const { session, membership } = await requireMembership(officeId);
  const userId = session.user.id;
  const t = await getTranslations();
  const locale = await getLocale();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [
    totalConsumed,
    thisMonthConsumed,
    recentRequests,
    totalOfficeConsumption,
    totalPurchaseCost,
    userPaidTotal,
    monthBatches,
    latestPeriod,
  ] = await Promise.all([
    prisma.consumptionEntry.aggregate({
      where: { userId, officeId },
      _sum: { qty: true },
    }),
    prisma.consumptionEntry.aggregate({
      where: {
        userId,
        officeId,
        date: { gte: monthStart, lt: monthEnd },
      },
      _sum: { qty: true },
    }),
    prisma.dailyRequest.findMany({
      where: { userId, officeId },
      orderBy: { date: "desc" },
      take: 10,
    }),
    prisma.consumptionEntry.aggregate({
      where: { officeId, date: { gte: monthStart, lt: monthEnd } },
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
    prisma.reimbursementPeriod.findFirst({
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

  // Breakdown: who does the user owe money to
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
        image: await resolveAvatarUrl(p.image),
        amount: Math.round(p.total * 100) / 100,
      })),
  );

  const hasPurchaseData = totalCost > 0;

  // Latest period data
  const periodLabel = latestPeriod
    ? formatPeriodLabel(latestPeriod.startDate, latestPeriod.endDate, locale)
    : null;
  const periodLines = latestPeriod
    ? await Promise.all(
        latestPeriod.lines.map(async (l) => {
          const other = l.fromUserId === userId ? l.toUser : l.fromUser;
          return {
            id: l.id,
            direction: l.fromUserId === userId ? "pay" as const : "receive" as const,
            otherUserName: other.name,
            otherUserImage: await resolveAvatarUrl(other.image),
            amount: l.amount.toNumber(),
            status: l.status,
          };
        }),
      )
    : [];
  const periodPaidCount = periodLines.filter((l) => l.status === "PAID").length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground">
          {t('dashboard.welcome', { name: session.user.name, office: membership.office.name })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('dashboard.thisMonth')}</CardDescription>
            <CardTitle className="text-3xl">{userMonthQty}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{t('dashboard.matesConsumed')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('dashboard.allTime')}</CardDescription>
            <CardTitle className="text-3xl">
              {totalConsumed._sum.qty ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{t('dashboard.matesConsumed')}</p>
          </CardContent>
        </Card>
      </div>

      {hasPurchaseData && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t('dashboard.yourShareEstimate')}</CardDescription>
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
              <CardDescription>{t('dashboard.youPaidEstimate')}</CardDescription>
              <CardTitle className="text-2xl">
                CHF {userPaid.toFixed(2)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t('dashboard.purchasesCoveredThisMonth')}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t('dashboard.netBalanceEstimate')}</CardDescription>
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
                    ? `−CHF ${Math.abs(netOwed).toFixed(2)}`
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
        </div>
      )}

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
                  <span className="text-sm text-red-600 dark:text-red-400">
                    CHF {entry.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {latestPeriod && (
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.latestSettlement', { period: periodLabel ?? '' })}</CardTitle>
            <CardDescription>
              {t('dashboard.finalizedPeriod')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {periodLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('dashboard.noPaymentsInPeriod')}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {t('dashboard.paidCount', { paid: periodPaidCount, total: periodLines.length })}
                </p>
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
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.recentRequests')}</CardTitle>
          <CardDescription>{t('dashboard.lastRequests')}</CardDescription>
        </CardHeader>
        <CardContent>
          {recentRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('dashboard.noRequestsYet')}
            </p>
          ) : (
            <div className="space-y-2">
              {recentRequests.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-sm font-medium">
                    {new Date(req.date).toLocaleDateString(locale)}
                  </span>
                  <Badge
                    variant={
                      req.status === "SERVED" ? "default" : "secondary"
                    }
                  >
                    {req.status === "SERVED" ? t('dashboard.served') : t('dashboard.requested')}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
