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
    return {
      avgDailyConsumption: 0,
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
