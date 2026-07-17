"use client";

import { Doughnut } from "react-chartjs-2";
import { useLocale } from "next-intl";
import {
  tooltipOptions,
  useChartTheme,
} from "@/components/stats/chart-kit";

interface ItemSlice {
  name: string;
  qty: number;
}

interface ItemsChartProps {
  readonly data: ItemSlice[];
  readonly otherLabel: string;
}

const MAX_SLICES = 5;

/**
 * Part-to-whole by maté. Anything past the 5 biggest items folds into
 * "Other" (never more slices, never more hues). The value list beside the
 * ring is the visible-label relief for the lighter palette slots.
 */
export function ItemsChart({ data, otherLabel }: ItemsChartProps) {
  const theme = useChartTheme();
  const locale = useLocale();

  const head = data.slice(0, MAX_SLICES);
  const tailQty = data.slice(MAX_SLICES).reduce((sum, d) => sum + d.qty, 0);
  const slices = tailQty > 0 ? [...head, { name: otherLabel, qty: tailQty }] : head;
  const colors = slices.map((_, i) =>
    tailQty > 0 && i === slices.length - 1 ? theme.deemphasis : theme.series[i],
  );
  const total = slices.reduce((sum, s) => sum + s.qty, 0);

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <div className="relative size-44">
        <Doughnut
          data={{
            labels: slices.map((s) => s.name),
            datasets: [
              {
                data: slices.map((s) => s.qty),
                backgroundColor: colors,
                borderColor: theme.surface,
                borderWidth: 2,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            cutout: "64%",
            plugins: {
              legend: { display: false },
              tooltip: tooltipOptions(theme),
            },
          }}
        />
      </div>
      <ul className="min-w-40 space-y-2">
        {slices.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: colors[i] }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="font-medium tabular-nums">
              {s.qty.toLocaleString(locale)}
            </span>
            <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
              {total > 0 ? Math.round((s.qty / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
