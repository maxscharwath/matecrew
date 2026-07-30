"use client";

import { Bar } from "react-chartjs-2";
import { useLocale, useTranslations } from "next-intl";
import {
  legendOptions,
  tooltipOptions,
  useChartTheme,
} from "@/components/stats/chart-kit";

interface TimelinePoint {
  /** "YYYY-MM-DD" for day/week buckets, "YYYY-MM" for month buckets. */
  key: string;
  mine: number;
  others: number;
}

interface TimelineChartProps {
  readonly data: TimelinePoint[];
  readonly granularity: "day" | "week" | "month";
  readonly meLabel: string;
  readonly othersLabel: string;
}

/**
 * Consumption per bucket as a stacked bar: my cans + the rest of the office
 * (they sum to the office total). Emphasis form — my share carries the accent,
 * the context is gray. Bucket width follows the selected period.
 */
export function TimelineChart({
  data,
  granularity,
  meLabel,
  othersLabel,
}: TimelineChartProps) {
  const theme = useChartTheme();
  const locale = useLocale();
  // Parameterized label — can't cross the server/client boundary as a prop.
  const t = useTranslations("stats");

  const labels = data.map((d, i) => {
    if (granularity === "month") {
      const [year, month] = d.key.split("-").map(Number);
      const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
        locale,
        { month: "short", timeZone: "UTC" },
      );
      // Anchor January (and the very first bar) with the year.
      return month === 1 || i === 0
        ? `${label} ${String(year).slice(2)}`
        : label;
    }
    return new Date(`${d.key}T00:00:00Z`).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
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
              ticks: {
                color: theme.mutedText,
                maxRotation: 0,
                autoSkipPadding: 12,
              },
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
            tooltip: {
              ...tooltipOptions(theme),
              callbacks:
                granularity === "week"
                  ? {
                      title: (items) =>
                        t("weekOf", { date: items[0]?.label ?? "" }),
                    }
                  : undefined,
            },
          },
        }}
      />
    </div>
  );
}
