"use client";

import { Chart as ChartJS, LineElement, PointElement } from "chart.js";
import { Line } from "react-chartjs-2";
import { useLocale } from "next-intl";
import {
  legendOptions,
  tooltipOptions,
  useChartTheme,
} from "@/components/stats/chart-kit";

ChartJS.register(LineElement, PointElement);

export interface PriceSeries {
  itemName: string;
  /** Billing price after each order — the moving average over remaining stock. */
  billing: number[];
  /** What was actually paid per can, at the orders that included this item. */
  purchase: (number | null)[];
  /** True where the billing price is the office-wide fallback, not this item's own. */
  estimated: boolean[];
}

interface PurchasePriceChartProps {
  /** Order dates (ISO strings), ascending. */
  readonly dates: string[];
  readonly series: PriceSeries[];
  readonly billingLabel: string;
  readonly paidLabel: string;
  readonly estimatedLabel: string;
}

/**
 * Billing price per item across orders. The line is what reimbursements charge:
 * a moving average over the stock still in the fridge, so it steps at each
 * delivery and holds until the next one.
 *
 * Every item spans the whole timeline, including before its first order — there
 * the office-wide price applies, drawn dashed. Dots mark orders that actually
 * contained the item, and the tooltip gives the price paid that day.
 */
export function PurchasePriceChart({
  dates,
  series,
  billingLabel,
  paidLabel,
  estimatedLabel,
}: PurchasePriceChartProps) {
  const theme = useChartTheme();
  const locale = useLocale();

  const labels = dates.map((d) =>
    new Date(d).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    }),
  );

  return (
    <div className="h-64">
      <Line
        data={{
          labels,
          datasets: series.map((s, i) => ({
            label: s.itemName,
            data: s.billing,
            borderColor: theme.series[i],
            backgroundColor: theme.series[i],
            borderWidth: 2,
            // A dot only where this item was actually bought.
            pointRadius: (ctx) => (s.purchase[ctx.dataIndex] != null ? 4 : 0),
            pointHoverRadius: (ctx) => (s.purchase[ctx.dataIndex] != null ? 5 : 0),
            // 2px surface ring so overlapping points stay separable.
            pointBorderColor: theme.surface,
            pointBorderWidth: 2,
            stepped: "after" as const,
            segment: {
              borderDash: (ctx) =>
                s.estimated[ctx.p0DataIndex] ? [4, 4] : undefined,
            },
          })),
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          scales: {
            x: {
              grid: { display: false },
              border: { color: theme.grid },
              ticks: { color: theme.mutedText, maxRotation: 0, autoSkip: true },
            },
            y: {
              beginAtZero: true,
              grid: { color: theme.grid },
              border: { display: false },
              ticks: {
                color: theme.mutedText,
                maxTicksLimit: 5,
                callback: (value) => `CHF ${Number(value).toFixed(2)}`,
              },
            },
          },
          plugins: {
            legend: legendOptions(theme),
            tooltip: {
              ...tooltipOptions(theme),
              callbacks: {
                label: (ctx) => {
                  const s = series[ctx.datasetIndex];
                  const billing = (ctx.raw as number).toFixed(2);
                  const paid = s?.purchase[ctx.dataIndex];
                  const suffix =
                    paid != null
                      ? ` (${paidLabel}: CHF ${paid.toFixed(2)})`
                      : s?.estimated[ctx.dataIndex]
                        ? ` (${estimatedLabel})`
                        : "";
                  return `${ctx.dataset.label}: ${billingLabel} CHF ${billing}${suffix}`;
                },
              },
            },
          },
        }}
      />
    </div>
  );
}
