"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type HeatmapCell = {
  date: string | null;
  qty: number;
  bucket: 0 | 1 | 2 | 3 | 4;
  countLabel?: string;
  dateLabel?: string;
};

interface Props {
  readonly weeks: HeatmapCell[][];
  readonly monthLabels: (string | null)[];
  readonly weekdayLabels: readonly [string, string, string, string, string, string, string];
  readonly legendLess: string;
  readonly legendMore: string;
}

const BUCKET_CLASSES = [
  "bg-muted/60 ring-1 ring-inset ring-border/40",
  "bg-amber-200 dark:bg-amber-950",
  "bg-amber-300 dark:bg-amber-800",
  "bg-amber-500 dark:bg-amber-600",
  "bg-amber-700 dark:bg-amber-400",
] as const;

export function MateActivityHeatmap({
  weeks,
  monthLabels,
  weekdayLabels,
  legendLess,
  legendMore,
}: Props) {
  // Cells size fluidly: each column is at most 0.85rem (desktop look), but
  // shrinks uniformly when the container is narrower so the whole year fits
  // without a horizontal scrollbar.
  const gridCols = `repeat(${weeks.length}, minmax(0, 0.85rem))`;

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>{legendLess}</span>
            {(["b0", "b1", "b2", "b3", "b4"] as const).map((k, i) => (
              <div
                key={k}
                className={cn("size-3 rounded-[3px]", BUCKET_CLASSES[i])}
              />
            ))}
            <span>{legendMore}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <div
            className="hidden grid-rows-7 pt-4 text-[10px] text-muted-foreground sm:grid"
            style={{ rowGap: "3px" }}
          >
            {weekdayLabels.map((d, i) => (
              <div
                key={d + i}
                className="flex h-[0.85rem] items-center pr-1 leading-3"
                style={{ visibility: i % 2 === 1 ? "visible" : "hidden" }}
              >
                {d}
              </div>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div
              className="grid h-3 gap-px text-[10px] text-muted-foreground sm:gap-0.75"
              style={{ gridTemplateColumns: gridCols }}
            >
              {monthLabels.map((label, i) => (
                <div
                  key={`m-${i}-${label ?? "x"}`}
                  className="overflow-hidden whitespace-nowrap leading-3"
                >
                  {label ?? ""}
                </div>
              ))}
            </div>

            <div
              className="grid grid-rows-7 gap-px sm:gap-0.75"
              style={{ gridTemplateColumns: gridCols, gridAutoFlow: "column" }}
            >
              {weeks.flatMap((week, w) =>
                week.map((cell, d) => {
                  if (!cell.date) {
                    return (
                      <div
                        key={`${w}-${d}`}
                        className="aspect-square w-full"
                        aria-hidden
                      />
                    );
                  }
                  return (
                    <Tooltip key={`${w}-${d}`}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "aspect-square w-full rounded-[3px] transition-all",
                            "hover:ring-2 hover:ring-amber-500 hover:ring-offset-1 hover:ring-offset-background",
                            "focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none",
                            BUCKET_CLASSES[cell.bucket],
                          )}
                          tabIndex={cell.qty > 0 ? 0 : -1}
                          aria-label={
                            cell.dateLabel && cell.countLabel
                              ? `${cell.countLabel}, ${cell.dateLabel}`
                              : undefined
                          }
                        />
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="flex flex-col items-center gap-0.5 px-2.5 py-1.5"
                      >
                        <span className="font-semibold">
                          {cell.countLabel}
                        </span>
                        {cell.dateLabel && (
                          <span className="text-[10px] opacity-80">
                            {cell.dateLabel}
                          </span>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                }),
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
