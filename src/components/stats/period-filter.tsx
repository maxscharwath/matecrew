"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarRange } from "lucide-react";
import { STATS_PERIODS, DEFAULT_STATS_PERIOD } from "@/lib/stats-period";
import { cn } from "@/lib/utils";

interface PeriodFilterProps {
  readonly period: string;
}

/**
 * Period scope for the whole stats screen. Lives in the URL (`?period=`) so
 * the server re-aggregates and the view stays shareable; the default period
 * is kept out of the query string.
 */
export function PeriodFilter({ period }: PeriodFilterProps) {
  const t = useTranslations("stats");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_STATS_PERIOD) params.delete("period");
    else params.set("period", next);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <div
      role="group"
      aria-label={t("periodLabel")}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border bg-background p-1 transition-opacity dark:bg-input/30",
        pending && "opacity-60",
      )}
    >
      <CalendarRange className="mx-1.5 size-4 shrink-0 text-muted-foreground" />
      {STATS_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => select(p)}
          aria-pressed={p === period}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
            p === period
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {t(`period_${p}`)}
        </button>
      ))}
    </div>
  );
}
