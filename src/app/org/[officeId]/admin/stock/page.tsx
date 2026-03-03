import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { StockCard } from "@/components/stock-card";
import { StockChart } from "@/components/stock-chart";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toISODateString } from "@/lib/date";

const REASON_LABELS: Record<string, string> = {
  SERVED: "Served",
  UNSERVED: "Unserved",
  ADJUSTMENT: "Adjustment",
  PURCHASE: "Purchase",
};

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function StockPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");

  const office = await prisma.office.findUniqueOrThrow({
    where: { id: officeId },
    include: { stock: true },
  });

  const currentQty = office.stock?.currentQty ?? 0;

  // Movements for the audit log (last 50)
  const recentMovements = await prisma.stockMovement.findMany({
    where: { officeId },
    take: 50,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true } },
    },
  });

  // Build chart data: daily stock snapshots over last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const movements = await prisma.stockMovement.findMany({
    where: {
      officeId,
      createdAt: { gte: thirtyDaysAgo },
    },
    orderBy: { createdAt: "asc" },
  });

  const totalDelta = movements.reduce((sum, m) => sum + m.delta, 0);
  const startQty = currentQty - totalDelta;

  const dailyMap = new Map<string, number>();
  let runningQty = startQty;

  for (const m of movements) {
    const day = toISODateString(m.createdAt);
    runningQty += m.delta;
    dailyMap.set(day, runningQty);
  }

  const chartData: { date: string; qty: number }[] = [];
  const cursor = new Date(thirtyDaysAgo);
  const today = new Date();
  let lastQty = startQty;

  while (cursor <= today) {
    const day = toISODateString(cursor);
    if (dailyMap.has(day)) {
      lastQty = dailyMap.get(day)!;
    }
    chartData.push({ date: day, qty: lastQty });
    cursor.setDate(cursor.getDate() + 1);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-bold">Stock — {office.name}</h1>
        <p className="mt-1 text-muted-foreground">
          Monitor and manage maté stock.
        </p>
      </div>

      <StockCard
        officeId={officeId}
        officeName={office.name}
        currentQty={currentQty}
        lowStockThreshold={office.lowStockThreshold}
      />

      <StockChart data={chartData} officeName={office.name} />

      {recentMovements.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Audit Log</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-center">Delta</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentMovements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-muted-foreground">
                      {m.createdAt.toLocaleString("fr-CH", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Europe/Zurich",
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {REASON_LABELS[m.reason] ?? m.reason}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-mono">
                      <span
                        className={
                          m.delta > 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </span>
                    </TableCell>
                    <TableCell>{m.user?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
