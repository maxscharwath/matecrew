"use client";

import { Doughnut } from "react-chartjs-2";
import { useLocale } from "next-intl";
import {
  itemSlots,
  slotColor,
  tooltipOptions,
  useChartTheme,
  type ItemDatum,
} from "@/components/stats/chart-kit";

interface ItemsChartProps {
  readonly data: ItemDatum[];
  readonly otherLabel: string;
}

/**
 * Part-to-whole by maté over the selected period. Anything past the 5 biggest
 * items folds into "Other". The value list beside the ring is the
 * visible-label relief for the lighter palette slots.
 */
export function ItemsChart({ data, otherLabel }: ItemsChartProps) {
  const theme = useChartTheme();
  const locale = useLocale();

  const qtyByItem = new Map(data.map((d) => [d.itemId, d.qty]));
  const slots = itemSlots(data, otherLabel);
  const slices = slots.map((slot, i) => ({
    name: slot.name,
    qty: slot.itemIds.reduce((sum, id) => sum + (qtyByItem.get(id) ?? 0), 0),
    color: slotColor(theme, slot, i),
  }));
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
                backgroundColor: slices.map((s) => s.color),
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
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-2 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: s.color }}
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
