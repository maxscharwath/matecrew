"use client";

import { Bar } from "react-chartjs-2";
import { useLocale } from "next-intl";
import {
  legendOptions,
  tooltipOptions,
  useChartTheme,
} from "@/components/stats/chart-kit";

interface MonthlyPoint {
  /** "YYYY-MM" */
  month: string;
  mine: number;
  others: number;
}

interface MonthlyChartProps {
  readonly data: MonthlyPoint[];
  readonly meLabel: string;
  readonly othersLabel: string;
}

/**
 * Office consumption per month as a stacked bar: my cans + the rest of the
 * office (they sum to the office total). Emphasis form — my share carries the
 * accent, the context is gray.
 */
export function MonthlyChart({ data, meLabel, othersLabel }: MonthlyChartProps) {
  const theme = useChartTheme();
  const locale = useLocale();

  const labels = data.map((d) => {
    const [year, month] = d.month.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, 1));
    const label = date.toLocaleDateString(locale, {
      month: "short",
      timeZone: "UTC",
    });
    // Anchor January (and the very first bar) with the year.
    return month === 1 || d === data[0]
      ? `${label} ${String(year).slice(2)}`
      : label;
  });

  return (
    <div className="h-64">
      <Bar
        data={{
          labels,
          datasets: [
            {
              label: meLabel,
              data: data.map((d) => d.mine),
              backgroundColor: theme.series[0],
              maxBarThickness: 24,
              stack: "total",
            },
            {
              label: othersLabel,
              data: data.map((d) => d.others),
              backgroundColor: theme.deemphasis,
              maxBarThickness: 24,
              stack: "total",
              // 2px surface gap below the segment + rounded data end on top.
              borderColor: theme.surface,
              borderWidth: { top: 0, right: 0, bottom: 2, left: 0 },
              borderSkipped: false,
              borderRadius: {
                topLeft: 4,
                topRight: 4,
                bottomLeft: 0,
                bottomRight: 0,
              },
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          scales: {
            x: {
              stacked: true,
              grid: { display: false },
              border: { color: theme.grid },
              ticks: { color: theme.mutedText },
            },
            y: {
              stacked: true,
              beginAtZero: true,
              grid: { color: theme.grid },
              border: { display: false },
              ticks: {
                color: theme.mutedText,
                precision: 0,
                maxTicksLimit: 5,
              },
            },
          },
          plugins: {
            legend: legendOptions(theme),
            tooltip: tooltipOptions(theme),
          },
        }}
      />
    </div>
  );
}
