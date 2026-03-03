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

  const [totalConsumed, thisMonthConsumed, recentRequests] =
    await Promise.all([
      prisma.consumptionEntry.aggregate({
        where: { userId, officeId },
        _sum: { qty: true },
      }),
      prisma.consumptionEntry.aggregate({
        where: {
          userId,
          officeId,
          date: {
            gte: new Date(
              new Date().getFullYear(),
              new Date().getMonth(),
              1
            ),
          },
        },
        _sum: { qty: true },
      }),
      prisma.dailyRequest.findMany({
        where: { userId, officeId },
        orderBy: { date: "desc" },
        take: 10,
      }),
    ]);

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
            <CardTitle className="text-3xl">
              {thisMonthConsumed._sum.qty ?? 0}
            </CardTitle>
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
