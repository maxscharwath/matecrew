import { prisma } from "@/lib/prisma";
import { StockChart } from "@/components/stock-chart";
import { DataPagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toISODateString } from "@/lib/date";
import { getTranslations, getLocale } from "next-intl/server";
import { predictReorder, type PredictionConfidence } from "@/lib/stock-prediction";
import { CalendarClock, TrendingDown, AlertTriangle, Info } from "lucide-react";

const PAGE_SIZE = 20;

// ── Skeleton fallbacks ───────────────────────────────────

export function StockPredictionFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-72 mt-1" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-16 w-full rounded-md" />
      </CardContent>
    </Card>
  );
}

export function StockChartFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-48 w-full rounded-md" />
      </CardContent>
    </Card>
  );
}

export function AuditLogFallback() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-24" />
      <Card>
        <CardContent className="space-y-2 pt-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Async sections ───────────────────────────────────────

interface PredictionProps {
  readonly officeId: string;
  readonly currentQty: number;
  readonly lowStockThreshold: number;
}

const CONFIDENCE_STYLE: Record<PredictionConfidence, { className: string; variant: "outline" | "secondary" | "destructive" }> = {
  high:         { className: "text-green-600 dark:text-green-400",  variant: "outline" },
  medium:       { className: "text-yellow-600 dark:text-yellow-400", variant: "outline" },
  low:          { className: "text-orange-600 dark:text-orange-400", variant: "outline" },
  insufficient: { className: "text-muted-foreground",                variant: "secondary" },
};

export async function StockPredictionSection({ officeId, currentQty, lowStockThreshold }: PredictionProps) {
  const t = await getTranslations();
  const locale = await getLocale();

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const movements = await prisma.stockMovement.findMany({
    where: { officeId, createdAt: { gte: sixtyDaysAgo } },
    orderBy: { createdAt: "asc" },
    select: { delta: true, reason: true, createdAt: true },
  });

  const prediction = predictReorder(currentQty, lowStockThreshold, movements);
  const { className: confidenceClass, variant: confidenceVariant } = CONFIDENCE_STYLE[prediction.confidence];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            {t("stock.prediction.title")}
          </CardTitle>
          <CardDescription>{t("stock.prediction.subtitle")}</CardDescription>
        </div>
        <Badge variant={confidenceVariant} className={`gap-1 ${confidenceClass}`}>
          {t(`stock.prediction.confidence.${prediction.confidence}`)}
        </Badge>
      </CardHeader>
      <CardContent>
        {prediction.confidence === "insufficient" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0" />
            {t("stock.prediction.notEnoughData")}
          </div>
        )}
        {prediction.confidence !== "insufficient" && prediction.predictedDepletionDate === null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0" />
            {t("stock.prediction.alreadyBelowThreshold")}
          </div>
        )}
        {prediction.confidence !== "insufficient" && prediction.predictedDepletionDate !== null && (
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                {t("stock.prediction.estimatedReorderDate")}
              </p>
              <p className="text-2xl font-bold flex items-center gap-2">
                {prediction.predictedDepletionDate.toLocaleDateString(locale, {
                  weekday: "short",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "Europe/Zurich",
                })}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("stock.prediction.inDays", { days: Math.round(prediction.daysUntilThreshold ?? 0) })}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                {t("stock.prediction.avgDailyConsumption")}
              </p>
              <p className="text-2xl font-bold flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-muted-foreground" />
                {prediction.avgDailyConsumption.toFixed(1)}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("stock.prediction.cansPerDay")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                {t("stock.prediction.reorderThreshold")}
              </p>
              <p className="text-2xl font-bold flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                {lowStockThreshold}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("stock.prediction.cans")}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ChartProps {
  readonly officeId: string;
  readonly officeName: string;
  readonly currentQty: number;
}

export async function StockChartSection({ officeId, officeName, currentQty }: ChartProps) {
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

  return <StockChart data={chartData} officeName={officeName} />;
}

interface AuditLogProps {
  readonly officeId: string;
  readonly page: number;
}

export async function AuditLogSection({ officeId, page }: AuditLogProps) {
  const t = await getTranslations();
  const locale = await getLocale();

  const [recentMovements, movementCount] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { officeId },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true } },
      },
    }),
    prisma.stockMovement.count({ where: { officeId } }),
  ]);

  if (recentMovements.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{t('stock.auditLog')}</h2>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('stock.date')}</TableHead>
              <TableHead>{t('stock.reason')}</TableHead>
              <TableHead className="text-center">{t('stock.delta')}</TableHead>
              <TableHead>{t('stock.user')}</TableHead>
              <TableHead>{t('stock.note')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentMovements.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-muted-foreground">
                  {m.createdAt.toLocaleString(locale, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Zurich",
                  })}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {t(`stock.reasonLabels.${m.reason}` as never)}
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
      <DataPagination totalItems={movementCount} pageSize={PAGE_SIZE} />
    </div>
  );
}
