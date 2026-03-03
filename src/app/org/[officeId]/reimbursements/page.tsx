import { TrendingDown, TrendingUp, Scale, Eye, CupSoda, Banknote } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireMembership } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import { UserReimbursementCard } from "@/components/user-reimbursement-card";
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

export default async function UserReimbursementsPage({ params }: Props) {
  const { officeId } = await params;
  const { session } = await requireMembership(officeId);
  const userId = session.user.id;
  const t = await getTranslations();

  // Current month preview
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
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

  // Settled periods
  const periods = await prisma.reimbursementPeriod.findMany({
    where: { officeId },
    orderBy: { startDate: "desc" },
    include: {
      lines: {
        where: {
          OR: [{ fromUserId: userId }, { toUserId: userId }],
        },
        include: {
          fromUser: { select: { name: true } },
          toUser: { select: { name: true } },
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

      const userLines = period.lines.map((l) => {
        if (l.fromUserId === userId) {
          return {
            lineId: l.id,
            direction: "pay" as const,
            otherUserName: l.toUser.name,
            amount: l.amount.toNumber(),
            status: l.status,
          };
        }
        return {
          lineId: l.id,
          direction: "receive" as const,
          otherUserName: l.fromUser.name,
          amount: l.amount.toNumber(),
          status: l.status,
        };
      });

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

  // Summary: only count PENDING payments
  const totalOwed = periodsWithData
    .flatMap((p) => p.lines)
    .filter((l) => l.direction === "pay" && l.status === "PENDING")
    .reduce((sum, l) => sum + l.amount, 0);
  const totalOwedToYou = periodsWithData
    .flatMap((p) => p.lines)
    .filter((l) => l.direction === "receive" && l.status === "PENDING")
    .reduce((sum, l) => sum + l.amount, 0);
  const netBalance = totalOwedToYou - totalOwed;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('reimbursements.userTitle')}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('reimbursements.userSubtitle')}
        </p>
      </div>

      {/* Balance overview */}
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

      {/* Current month preview */}
      {hasPreviewData && (
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
      )}

      {/* Settled periods */}
      {periodsWithData.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('reimbursements.noPeriodsCreated')}
        </p>
      ) : (
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
      )}
    </div>
  );
}
