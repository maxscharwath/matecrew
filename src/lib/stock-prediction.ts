import { StockMovementReason } from "@/generated/prisma/client";

interface Movement {
  delta: number;
  reason: StockMovementReason;
  createdAt: Date;
}

export type PredictionConfidence = "high" | "medium" | "low" | "insufficient";

export interface StockPrediction {
  /** Weighted average daily consumption (cans/day) */
  avgDailyConsumption: number;
  /** Predicted date when stock hits the threshold, or null if rate is 0 */
  predictedDepletionDate: Date | null;
  /** Days until threshold is reached, or null if rate is 0 */
  daysUntilThreshold: number | null;
  /** Confidence level based on number of days with data */
  confidence: PredictionConfidence;
  /** Number of days that had at least one consumption event */
  dataPointDays: number;
}

/**
 * Predicts when stock will reach `threshold` given historical movements.
 *
 * Algorithm: exponentially-weighted moving average of daily consumption.
 * Weight for a day `d` days ago = exp(-d * ln(2) / HALF_LIFE_DAYS)
 * This means a day 14 days ago counts half as much as today.
 */
export function predictReorder(
  currentQty: number,
  threshold: number,
  movements: Movement[],
  referenceDate = new Date(),
): StockPrediction {
  const HALF_LIFE_DAYS = 14;
  const WINDOW_DAYS = 60;

  // Build a map of ISO date → total consumption (abs delta for SERVED only)
  const dailyConsumption = new Map<string, number>();

  for (const m of movements) {
    if (m.reason !== StockMovementReason.SERVED) continue;
    const day = toISODateString(m.createdAt);
    dailyConsumption.set(day, (dailyConsumption.get(day) ?? 0) + Math.abs(m.delta));
  }

  // For each day in the window, compute weighted contribution
  let weightedSum = 0;
  let totalWeight = 0;
  let dataPointDays = 0;

  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  for (let d = 0; d < WINDOW_DAYS; d++) {
    const cursor = new Date(today);
    cursor.setDate(cursor.getDate() - d);
    const day = toISODateString(cursor);
    const consumed = dailyConsumption.get(day) ?? 0;

    const weight = Math.exp((-d * Math.LN2) / HALF_LIFE_DAYS);
    weightedSum += weight * consumed;
    totalWeight += weight;

    if (consumed > 0) dataPointDays++;
  }

  const avgDailyConsumption = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const confidence = computeConfidence(dataPointDays);

  if (avgDailyConsumption <= 0 || currentQty <= threshold) {
    // The rate is still reported: a shelf already under its threshold keeps
    // draining, and the chart's forward line needs a slope to draw.
    return {
      avgDailyConsumption,
      predictedDepletionDate: null,
      daysUntilThreshold: null,
      confidence,
      dataPointDays,
    };
  }

  const daysUntilThreshold = Math.max(0, (currentQty - threshold) / avgDailyConsumption);
  const predictedDepletionDate = new Date(today);
  predictedDepletionDate.setDate(predictedDepletionDate.getDate() + Math.round(daysUntilThreshold));

  return {
    avgDailyConsumption,
    predictedDepletionDate,
    daysUntilThreshold,
    confidence,
    dataPointDays,
  };
}

function computeConfidence(dataPointDays: number): PredictionConfidence {
  if (dataPointDays >= 14) return "high";
  if (dataPointDays >= 7) return "medium";
  if (dataPointDays >= 3) return "low";
  return "insufficient";
}

function toISODateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The same forecast, run once per item.
 *
 * An office-wide average hides the flavour that runs out next: two hundred
 * cans on the shelf read as comfortable right up to the morning the only mint
 * one is gone. Each item is fitted on its own movements and compared to its
 * own threshold.
 */
export function predictReorderByItem<
  T extends { id: string; currentQty: number; threshold: number },
>(
  items: readonly T[],
  movements: readonly (Movement & { itemId: string })[],
  referenceDate = new Date(),
): (T & { prediction: StockPrediction })[] {
  const byItem = new Map<string, Movement[]>();
  for (const m of movements) {
    const list = byItem.get(m.itemId);
    if (list) list.push(m);
    else byItem.set(m.itemId, [m]);
  }
  return items.map((item) => ({
    ...item,
    prediction: predictReorder(
      item.currentQty,
      item.threshold,
      byItem.get(item.id) ?? [],
      referenceDate,
    ),
  }));
}

/**
 * Straight-line continuation of a stock pool: one point per day from tomorrow
 * to `days` ahead, draining at `avgDailyConsumption`.
 *
 * Floored at zero, because a shelf cannot go negative — a line that dipped
 * under would read as a forecast of debt rather than of an empty fridge.
 */
export function projectStockLevels(
  currentQty: number,
  avgDailyConsumption: number,
  days: number,
  referenceDate = new Date(),
): { date: string; qty: number }[] {
  // Anchored on the UTC day the reference date falls in, the same day key the
  // history line is bucketed under, so the two halves of the chart meet on one
  // shared date whatever timezone the server runs in.
  const start = new Date(`${toISODateString(referenceDate)}T00:00:00Z`);

  const points: { date: string; qty: number }[] = [];
  for (let d = 1; d <= days; d++) {
    const cursor = new Date(start);
    cursor.setUTCDate(cursor.getUTCDate() + d);
    points.push({
      date: toISODateString(cursor),
      qty: Math.max(0, Math.round((currentQty - avgDailyConsumption * d) * 10) / 10),
    });
  }
  return points;
}
