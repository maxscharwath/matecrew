"use client";

import { Bar } from "react-chartjs-2";
import {
  tooltipOptions,
  useChartTheme,
} from "@/components/stats/chart-kit";

interface UserBar {
  name: string;
  qty: number;
}

interface UsersChartProps {
  readonly data: UserBar[];
  readonly seriesLabel: string;
}

/**
 * All-time cans per member, horizontal. One series → one color; the names
 * are the identity channel, so no legend box is needed.
 */
export function UsersChart({ data, seriesLabel }: UsersChartProps) {
  const theme = useChartTheme();
  const height = Math.max(160, data.length * 34 + 48);

  return (
    <div style={{ height }}>
      <Bar
        data={{
          labels: data.map((d) => d.name),
          datasets: [
            {
              label: seriesLabel,
              data: data.map((d) => d.qty),
              backgroundColor: theme.series[0],
              maxBarThickness: 20,
              borderRadius: 4,
              borderSkipped: "start",
            },
          ],
        }}
        options={{
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: theme.grid },
              border: { display: false },
              ticks: {
                color: theme.mutedText,
                precision: 0,
                maxTicksLimit: 6,
              },
            },
            y: {
              grid: { display: false },
              border: { color: theme.grid },
              ticks: { color: theme.secondaryText },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: tooltipOptions(theme),
          },
        }}
      />
    </div>
  );
}
