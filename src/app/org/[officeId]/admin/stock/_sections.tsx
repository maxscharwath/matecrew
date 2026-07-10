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
import { ITEM_DISPLAY_ORDER, sumStockQty } from "@/lib/items";
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
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export async function StockChartSection({ officeId, officeName }: ChartProps) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Items (with their current stock) + the movements needed to reconstruct the
  // 30-day trend of each item's pool.
  const [items, movements] = await Promise.all([
    prisma.item.findMany({
      where: { officeId },
      orderBy: ITEM_DISPLAY_ORDER,
      select: {
        id: true,
        name: true,
        stock: { select: { currentQty: true } },
      },
    }),
    prisma.stockMovement.findMany({
      where: { officeId, createdAt: { gte: thirtyDaysAgo } },
      orderBy: { createdAt: "asc" },
      select: { itemId: true, delta: true, createdAt: true },
    }),
  ]);

  // Only chart items that currently have stock or moved in the window — keeps
  // long-archived items out of the legend.
  const movedItemIds = new Set(movements.map((m) => m.itemId));
  const shownItems = items.filter(
    (i) => i.stock.length > 0 || movedItemIds.has(i.id),
  );

  if (shownItems.length === 0) return null;

  const series = shownItems.map((item, idx) => ({
    key: `item${idx}`,
    itemId: item.id,
    name: item.name,
    color: CHART_COLORS[idx % CHART_COLORS.length],
  }));
  // Back-solve each item's starting quantity from its current qty minus the
  // deltas inside the window, then walk forward day by day.
  const currentByItem = new Map(
    shownItems.map((i) => [i.id, sumStockQty(i.stock)]),
  );
  const windowDeltaByItem = new Map<string, number>();
  for (const m of movements) {
    windowDeltaByItem.set(
      m.itemId,
      (windowDeltaByItem.get(m.itemId) ?? 0) + m.delta,
    );
  }
  const runningByItem = new Map(
    shownItems.map((i) => [
      i.id,
      (currentByItem.get(i.id) ?? 0) - (windowDeltaByItem.get(i.id) ?? 0),
    ]),
  );

  // Movements bucketed by day so we can apply them as the cursor advances.
  const movementsByDay = new Map<string, { itemId: string; delta: number }[]>();
  for (const m of movements) {
    const day = toISODateString(m.createdAt);
    const list = movementsByDay.get(day) ?? [];
    list.push({ itemId: m.itemId, delta: m.delta });
    movementsByDay.set(day, list);
  }

  const chartData: Record<string, string | number>[] = [];
  const cursor = new Date(thirtyDaysAgo);
  const today = new Date();

  while (cursor <= today) {
    const day = toISODateString(cursor);
    for (const m of movementsByDay.get(day) ?? []) {
      runningByItem.set(m.itemId, (runningByItem.get(m.itemId) ?? 0) + m.delta);
    }
    const row: Record<string, string | number> = { date: day };
    for (const s of series) {
      row[s.key] = runningByItem.get(s.itemId) ?? 0;
    }
    chartData.push(row);
    cursor.setDate(cursor.getDate() + 1);
  }

  return (
    <StockChart
      data={chartData}
      series={series.map((s) => ({ key: s.key, name: s.name, color: s.color }))}
      officeName={officeName}
    />
  );
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
        item: { select: { name: true } },
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
              <TableHead>{t('stock.item')}</TableHead>
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
                <TableCell className="text-muted-foreground">{m.item.name}</TableCell>
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
