import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { ITEM_DISPLAY_ORDER, sumStockQty } from "@/lib/items";
import { effectiveLowStockThreshold } from "@/lib/stock";
import {
  predictReorder,
  predictReorderByItem,
  type StockPrediction,
} from "@/lib/stock-prediction";

/** Days of movements the consumption rate is fitted on. */
export const FORECAST_FIT_DAYS = 60;
/** Days of real stock levels the chart draws behind today. */
export const HISTORY_DAYS = 30;
/** Bounds on how far the dashed half of the chart reaches. */
const MIN_FORECAST_DAYS = 7;
const MAX_FORECAST_DAYS = 45;

/**
 * Palette slots for items an admin hasn't pinned a colour to. Same CSS vars
 * the rest of the app's recharts surfaces use, so the stock chart, its legend
 * and the forecast table all name an item with one hue.
 */
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export interface ItemForecast {
  itemId: string;
  name: string;
  /** Pinned colour, or the palette slot this item's rank earns it. */
  color: string;
  currentQty: number;
  /** The item's own reorder threshold, or the office's when it has none. */
  threshold: number;
  /** True when the item already sits at or under its threshold. */
  isLow: boolean;
  prediction: StockPrediction;
}

export interface StockMovementPoint {
  itemId: string;
  delta: number;
  createdAt: Date;
}

export interface StockForecast {
  officeName: string;
  /** Items worth charting: still listed, or still holding cans. */
  items: ItemForecast[];
  /** The whole shelf, forecast as one pool. */
  office: {
    currentQty: number;
    threshold: number;
    prediction: StockPrediction;
  };
  /** Movements over the fit window, oldest first. */
  movements: StockMovementPoint[];
  /** How many days ahead the projection is worth drawing. */
  horizonDays: number;
}

/**
 * Everything the stock screen needs to talk about the future: per-item
 * consumption rates, reorder dates and the movements behind them.
 *
 * `cache`d because the forecast card and the chart are separate streamed
 * sections of the same page — they ask the same question and should get the
 * same answer, from one round-trip.
 */
export const loadStockForecast = cache(
  async (officeId: string): Promise<StockForecast> => {
    const fitStart = new Date();
    fitStart.setDate(fitStart.getDate() - FORECAST_FIT_DAYS);

    const [office, items, movements] = await Promise.all([
      prisma.office.findUniqueOrThrow({
        where: { id: officeId },
        select: { name: true, lowStockThreshold: true },
      }),
      prisma.item.findMany({
        where: { officeId },
        orderBy: ITEM_DISPLAY_ORDER,
        select: {
          id: true,
          name: true,
          color: true,
          active: true,
          lowStockThreshold: true,
          stock: { select: { currentQty: true } },
        },
      }),
      prisma.stockMovement.findMany({
        where: { officeId, createdAt: { gte: fitStart } },
        orderBy: { createdAt: "asc" },
        select: { itemId: true, delta: true, reason: true, createdAt: true },
      }),
    ]);

    // An archived flavour with cans left on the shelf still drains and still
    // belongs on the chart; an archived one with nothing left is history.
    const movedItemIds = new Set(movements.map((m) => m.itemId));
    const shown = items.filter(
      (i) => i.active || i.stock.length > 0 || movedItemIds.has(i.id),
    );

    const rows = shown.map((item, idx) => ({
      id: item.id,
      name: item.name,
      color: item.color ?? CHART_COLORS[idx % CHART_COLORS.length],
      currentQty: sumStockQty(item.stock),
      threshold: effectiveLowStockThreshold(
        item.lowStockThreshold,
        office.lowStockThreshold,
      ),
    }));

    const itemForecasts: ItemForecast[] = predictReorderByItem(
      rows,
      movements,
    ).map((r) => ({
      itemId: r.id,
      name: r.name,
      color: r.color,
      currentQty: r.currentQty,
      threshold: r.threshold,
      isLow: r.currentQty <= r.threshold,
      prediction: r.prediction,
    }));

    const currentQty = rows.reduce((sum, r) => sum + r.currentQty, 0);
    // The shelf as a whole reorders when it reaches what its items each want to
    // keep in reserve, so the office floor is the sum of their thresholds
    // rather than the office number on its own.
    const thresholdTotal = rows.reduce((sum, r) => sum + r.threshold, 0);

    return {
      officeName: office.name,
      items: itemForecasts,
      office: {
        currentQty,
        threshold: thresholdTotal,
        prediction: predictReorder(currentQty, thresholdTotal, movements),
      },
      movements: movements.map((m) => ({
        itemId: m.itemId,
        delta: m.delta,
        createdAt: m.createdAt,
      })),
      horizonDays: forecastHorizon(itemForecasts),
    };
  },
);

/**
 * How far ahead to draw: just past the last item's reorder date, so every
 * crossing is on screen, but never so far that a barely-touched flavour
 * stretches the axis into next season.
 */
function forecastHorizon(items: readonly ItemForecast[]): number {
  const crossings = items
    .map((i) => i.prediction.daysUntilThreshold)
    .filter((d): d is number => d !== null);
  const furthest = crossings.length > 0 ? Math.max(...crossings) : 0;
  return Math.min(
    MAX_FORECAST_DAYS,
    Math.max(MIN_FORECAST_DAYS, Math.ceil(furthest) + 3),
  );
}
