import { prisma } from "@/lib/prisma";
import { buildCostingLedger } from "@/lib/costing";
import { roundCents } from "@/lib/money";
import { SignedMoney } from "@/components/signed-money";
import { StockChart } from "@/components/stock-chart";
import { DataPagination } from "@/components/pagination";
import { SignedQty } from "@/components/signed-qty";
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
import { projectStockLevels, type PredictionConfidence } from "@/lib/stock-prediction";
import { HISTORY_DAYS, loadStockForecast } from "@/lib/stock-forecast";
import { CalendarClock, TrendingDown, AlertTriangle, Info } from "lucide-react";
import { TableFilter } from "@/components/table-filter";
import { CancelCountButton } from "@/components/cancel-count-button";

const PAGE_SIZE = 20;
const COUNT_PAGE_SIZE = 10;

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

export function CountHistoryFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1 h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </CardContent>
    </Card>
  );
}

// ── Async sections ───────────────────────────────────────

interface PredictionProps {
  readonly officeId: string;
}

const CONFIDENCE_STYLE: Record<PredictionConfidence, { className: string; variant: "outline" | "secondary" | "destructive" }> = {
  high:         { className: "text-green-600 dark:text-green-400",  variant: "outline" },
  medium:       { className: "text-yellow-600 dark:text-yellow-400", variant: "outline" },
  low:          { className: "text-orange-600 dark:text-orange-400", variant: "outline" },
  insufficient: { className: "text-muted-foreground",                variant: "secondary" },
};

export async function StockPredictionSection({ officeId }: PredictionProps) {
  const t = await getTranslations();
  const locale = await getLocale();

  const forecast = await loadStockForecast(officeId);
  const { prediction, threshold } = forecast.office;
  const { className: confidenceClass, variant: confidenceVariant } = CONFIDENCE_STYLE[prediction.confidence];

  const formatDate = (date: Date) =>
    date.toLocaleDateString(locale, {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Zurich",
    });

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
                {formatDate(prediction.predictedDepletionDate)}
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
                {threshold}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("stock.prediction.cans")}
              </p>
            </div>
          </div>
        )}

        {/* The office total is the number you order on, but it is the single
            flavour that empties first which people actually notice, so every
            item gets its own rate, its own floor and its own date. */}
        {forecast.items.length > 1 && (
          <div className="mt-6">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              {t("stock.prediction.perItemTitle")}
            </p>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("stock.item")}</TableHead>
                    <TableHead className="text-right">{t("stock.prediction.stockColumn")}</TableHead>
                    <TableHead className="text-right">{t("stock.prediction.thresholdColumn")}</TableHead>
                    <TableHead className="text-right">{t("stock.prediction.rateColumn")}</TableHead>
                    <TableHead className="text-right">{t("stock.prediction.reorderColumn")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {forecast.items.map((item) => (
                    <TableRow key={item.itemId}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2.5 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="truncate font-medium">{item.name}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        <span className={item.isLow ? "text-destructive font-semibold" : undefined}>
                          {item.currentQty}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {item.threshold}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {item.prediction.avgDailyConsumption.toFixed(1)}
                      </TableCell>
                      {/* A date when there is one, and otherwise the reason
                          there isn't — an empty cell would read as "fine". */}
                      <TableCell className="text-right">
                        {item.isLow ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="size-3" />
                            {t("stock.prediction.reorderNow")}
                          </Badge>
                        ) : item.prediction.predictedDepletionDate === null ? (
                          <span className="text-muted-foreground">
                            {t("stock.prediction.noTrend")}
                          </span>
                        ) : (
                          <span className="whitespace-nowrap">
                            {formatDate(item.prediction.predictedDepletionDate)}
                            <span className="ml-2 text-muted-foreground tabular-nums">
                              {t("stock.prediction.inDays", {
                                days: Math.round(item.prediction.daysUntilThreshold ?? 0),
                              })}
                            </span>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ChartProps {
  readonly officeId: string;
}

export async function StockChartSection({ officeId }: ChartProps) {
  const forecast = await loadStockForecast(officeId);
  if (forecast.items.length === 0) return null;

  const historyStart = new Date();
  historyStart.setDate(historyStart.getDate() - HISTORY_DAYS);
  const history = forecast.movements.filter((m) => m.createdAt >= historyStart);

  const series = forecast.items.map((item, idx) => ({
    key: `item${idx}`,
    forecastKey: `item${idx}f`,
    itemId: item.itemId,
    name: item.name,
    color: item.color,
  }));

  // Back-solve each item's starting quantity from its current qty minus the
  // deltas inside the window, then walk forward day by day.
  const windowDeltaByItem = new Map<string, number>();
  for (const m of history) {
    windowDeltaByItem.set(
      m.itemId,
      (windowDeltaByItem.get(m.itemId) ?? 0) + m.delta,
    );
  }
  const runningByItem = new Map(
    forecast.items.map((i) => [
      i.itemId,
      i.currentQty - (windowDeltaByItem.get(i.itemId) ?? 0),
    ]),
  );

  // Movements bucketed by day so we can apply them as the cursor advances.
  const movementsByDay = new Map<string, { itemId: string; delta: number }[]>();
  for (const m of history) {
    const day = toISODateString(m.createdAt);
    const list = movementsByDay.get(day) ?? [];
    list.push({ itemId: m.itemId, delta: m.delta });
    movementsByDay.set(day, list);
  }

  const chartData: Record<string, string | number | null>[] = [];
  const cursor = new Date(historyStart);
  const today = new Date();

  while (cursor <= today) {
    const day = toISODateString(cursor);
    for (const m of movementsByDay.get(day) ?? []) {
      runningByItem.set(m.itemId, (runningByItem.get(m.itemId) ?? 0) + m.delta);
    }
    const row: Record<string, string | number | null> = { date: day };
    for (const s of series) {
      row[s.key] = runningByItem.get(s.itemId) ?? 0;
      row[s.forecastKey] = null;
    }
    chartData.push(row);
    cursor.setDate(cursor.getDate() + 1);
  }

  // Only project when something is actually moving: a flat line drawn out for
  // another month says "nothing will change", which is a claim the data does
  // not support — it says nobody drank anything lately.
  const projections = forecast.items
    .filter((i) => i.prediction.avgDailyConsumption > 0)
    .map((i) => ({
      itemId: i.itemId,
      points: projectStockLevels(
        i.currentQty,
        i.prediction.avgDailyConsumption,
        forecast.horizonDays,
      ),
    }));

  const pointsByItem = new Map(projections.map((p) => [p.itemId, p.points]));
  const todayRow = chartData.at(-1);
  if (projections.length > 0 && todayRow) {
    // The dashed line starts where the solid one ends, so the two halves read
    // as one curve rather than as two charts sharing an axis.
    for (const s of series) {
      if (pointsByItem.has(s.itemId)) todayRow[s.forecastKey] = todayRow[s.key];
    }

    for (let d = 0; d < forecast.horizonDays; d++) {
      const row: Record<string, string | number | null> = {
        date: projections[0].points[d].date,
      };
      for (const s of series) {
        row[s.key] = null;
        row[s.forecastKey] = pointsByItem.get(s.itemId)?.[d].qty ?? null;
      }
      chartData.push(row);
    }
  }

  return (
    <StockChart
      data={chartData}
      series={series.map((s) => ({
        key: s.key,
        forecastKey: s.forecastKey,
        name: s.name,
        color: s.color,
      }))}
      officeName={forecast.officeName}
      historyDays={HISTORY_DAYS}
      forecastDays={projections.length > 0 ? forecast.horizonDays : 0}
      todayDate={todayRow?.date as string | undefined}
    />
  );
}

interface AuditLogProps {
  readonly officeId: string;
  readonly page: number;
  readonly userIds: readonly string[];
  readonly itemIds: readonly string[];
}

export async function AuditLogSection({
  officeId,
  page,
  userIds,
  itemIds,
}: AuditLogProps) {
  const t = await getTranslations();
  const locale = await getLocale();

  const where = {
    officeId,
    ...(userIds.length > 0 ? { userId: { in: [...userIds] } } : {}),
    ...(itemIds.length > 0 ? { itemId: { in: [...itemIds] } } : {}),
  };

  // Both filters only offer values that actually appear in this office's log,
  // so no combination of boxes can point at movements that never existed.
  const [recentMovements, movementCount, movementUsers, movementItems] =
    await Promise.all([
      prisma.stockMovement.findMany({
        where,
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true } },
          item: { select: { name: true } },
        },
      }),
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where: { officeId, userId: { not: null } },
        distinct: ["userId"],
        select: { user: { select: { id: true, name: true } } },
      }),
      prisma.stockMovement.findMany({
        where: { officeId },
        distinct: ["itemId"],
        select: { item: { select: { id: true, name: true } } },
      }),
    ]);

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, locale);
  const users = movementUsers
    .flatMap((m) => (m.user ? [m.user] : []))
    .sort(byName);
  const items = movementItems.map((m) => m.item).sort(byName);

  if (users.length === 0 && items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('stock.auditLog')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <TableFilter
            options={items}
            selected={itemIds}
            param="item"
            icon="item"
            label={t("stock.filterByItem")}
            allLabel={t("stock.allItems")}
          />
          <TableFilter
            options={users}
            selected={userIds}
            param="user"
            icon="user"
            label={t("stock.filterByUser")}
            allLabel={t("stock.allUsers")}
          />
        </div>
      </div>
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
            {recentMovements.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  {t('stock.noMovementsForFilter')}
                </TableCell>
              </TableRow>
            )}
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
                  <SignedQty value={m.delta} />
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

interface CountHistoryProps {
  readonly officeId: string;
  readonly page: number;
}

export async function CountHistorySection({ officeId, page }: CountHistoryProps) {
  const t = await getTranslations();
  const locale = await getLocale();

  // The ledger depends on nothing here, so it shares the round trip.
  const [counts, total, ledger] = await Promise.all([
    prisma.stockCount.findMany({
      where: { officeId },
      orderBy: { countedAt: "desc" },
      skip: (page - 1) * COUNT_PAGE_SIZE,
      take: COUNT_PAGE_SIZE,
      include: {
        countedBy: { select: { name: true } },
        lines: { include: { item: { select: { name: true } } } },
      },
    }),
    prisma.stockCount.count({ where: { officeId } }),
    buildCostingLedger(officeId),
  ]);

  if (total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("inventory.history")}</CardTitle>
          <CardDescription>{t("inventory.historyDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("inventory.noCounts")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Read the francs the settlement actually charged for each gap, rather than
  // re-deriving them from a price: a gap bigger than the item's own stock is
  // partly billed at the office rate, so recomputing would quote the admin a
  // different number here than on their invoice.
  const shrinkage = new Map<string, number>();
  for (const draw of ledger.draws) {
    if (draw.kind === "SHRINKAGE") shrinkage.set(draw.sourceId, draw.cost);
  }

  const rows = counts.map((count) => {
    const gaps = count.lines.filter((l) => l.delta !== 0);
    const value = gaps.reduce((sum, l) => sum + (shrinkage.get(l.id) ?? 0), 0);
    return {
      id: count.id,
      countedAt: count.countedAt,
      countedBy: count.countedBy.name,
      note: count.note,
      cancelledAt: count.cancelledAt,
      // A cancelled count bills nothing, so it is worth nothing — the ledger
      // has already dropped its lines, and this keeps the column honest.
      value: count.cancelledAt ? 0 : roundCents(value),
      gapCans: gaps.reduce((sum, l) => sum + Math.abs(l.delta), 0),
      gaps: gaps.map((l) => ({
        itemName: l.item.name,
        expectedQty: l.expectedQty,
        countedQty: l.countedQty,
        delta: l.delta,
      })),
    };
  });

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("inventory.history")}</CardTitle>
          <CardDescription>{t("inventory.historyDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("inventory.date")}</TableHead>
                <TableHead>{t("inventory.countedBy")}</TableHead>
                <TableHead>{t("inventory.gap")}</TableHead>
                <TableHead className="text-right">
                  {t("inventory.gapValue")}
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap align-top">
                    {row.countedAt.toLocaleDateString(locale, {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="align-top">{row.countedBy}</TableCell>
                  <TableCell className="align-top">
                    {row.gaps.length === 0 ? (
                      <Badge variant="outline">{t("inventory.noGap")}</Badge>
                    ) : (
                      <div className="space-y-0.5 text-sm">
                        {row.gaps.map((gap) => (
                          <div key={gap.itemName} className="tabular-nums">
                            <span className="font-medium">{gap.itemName}</span>{" "}
                            <SignedQty value={gap.delta} />{" "}
                            <span className="text-muted-foreground">
                              ({gap.expectedQty} → {gap.countedQty})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {row.note && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.note}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    {row.cancelledAt ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <SignedMoney value={row.value} />
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {row.cancelledAt ? (
                      <Badge variant="secondary">{t("stock.countCancelledBadge")}</Badge>
                    ) : (
                      <CancelCountButton
                        officeId={officeId}
                        countId={row.id}
                        gapCans={row.gapCans}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <DataPagination totalItems={total} pageSize={COUNT_PAGE_SIZE} pageParam="count" />
    </div>
  );
}
