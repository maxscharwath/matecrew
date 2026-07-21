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
  /** Unit price at each order date; null where the order had no line for this item. */
  prices: (number | null)[];
  /** Cumulative weighted-average price after each order (the billing price). */
  runningAvg: (number | null)[];
}

interface PurchasePriceChartProps {
  /** Order dates (ISO strings), ascending. */
  readonly dates: string[];
  readonly series: PriceSeries[];
  readonly avgLabel: string;
}

/**
 * Unit price per item across orders. Stepped line — a price holds until the
 * next order changes it. The tooltip also shows the running weighted average,
 * which is the price reimbursements actually bill at.
 */
export function PurchasePriceChart({ dates, series, avgLabel }: PurchasePriceChartProps) {
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
            data: s.prices,
            borderColor: theme.series[i],
            backgroundColor: theme.series[i],
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 5,
            // 2px surface ring so overlapping points stay separable.
            pointBorderColor: theme.surface,
            pointBorderWidth: 2,
            stepped: "after" as const,
            spanGaps: true,
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
              filter: (item) => item.raw != null,
              callbacks: {
                label: (ctx) => {
                  const price = (ctx.raw as number).toFixed(2);
                  const avg = series[ctx.datasetIndex]?.runningAvg[ctx.dataIndex];
                  const avgText =
                    avg != null ? ` (${avgLabel}: CHF ${avg.toFixed(2)})` : "";
                  return `${ctx.dataset.label}: CHF ${price}${avgText}`;
                },
              },
            },
          },
        }}
      />
    </div>
  );
}
