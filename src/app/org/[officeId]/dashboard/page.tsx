import { requireMembership } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
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

export default async function DashboardPage({ params }: Props) {
  const { officeId } = await params;
  const { session, membership } = await requireMembership(officeId);
  const userId = session.user.id;

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
        paidBy: { select: { id: true, name: true } },
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
  const payerTotals = new Map<string, { name: string; total: number }>();
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
        total: userShareOfBatch,
      });
    }
  }

  const owesTo = [...payerTotals.values()]
    .filter((p) => p.total > 0.01)
    .map((p) => ({ name: p.name, amount: Math.round(p.total * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);

  const hasPurchaseData = totalCost > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome, {session.user.name} &mdash; {membership.office.name}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>This month</CardDescription>
            <CardTitle className="text-3xl">{userMonthQty}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">matés consumed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>All time</CardDescription>
            <CardTitle className="text-3xl">
              {totalConsumed._sum.qty ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">matés consumed</p>
          </CardContent>
        </Card>
      </div>

      {hasPurchaseData && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Your share this month</CardDescription>
              <CardTitle className="text-2xl">
                CHF {userShare.toFixed(2)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                based on consumption
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>You paid this month</CardDescription>
              <CardTitle className="text-2xl">
                CHF {userPaid.toFixed(2)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                purchases you covered
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Net balance</CardDescription>
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
                  ? "you owe"
                  : netOwed < 0
                    ? "you are owed"
                    : "settled"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {owesTo.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>You Owe</CardTitle>
            <CardDescription>
              Breakdown of what you owe to each payer this month
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {owesTo.map((entry) => (
                <div
                  key={entry.name}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-sm font-medium">{entry.name}</span>
                  <span className="text-sm text-red-600 dark:text-red-400">
                    CHF {entry.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Requests</CardTitle>
          <CardDescription>Your last 10 daily requests</CardDescription>
        </CardHeader>
        <CardContent>
          {recentRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No requests yet. Head to the Request page to get your first maté!
            </p>
          ) : (
            <div className="space-y-2">
              {recentRequests.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-sm font-medium">
                    {new Date(req.date).toLocaleDateString("fr-CH")}
                  </span>
                  <Badge
                    variant={
                      req.status === "SERVED" ? "default" : "secondary"
                    }
                  >
                    {req.status === "SERVED" ? "Served" : "Requested"}
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
