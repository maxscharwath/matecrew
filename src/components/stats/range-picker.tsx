"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { enUS, fr } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface RangePickerProps {
  /** "YYYY-MM-DD" bounds currently in the URL, when a custom range is active. */
  readonly from?: string;
  readonly to?: string;
}

/**
 * Reads a day out of the URL as a *local* midnight, and writes one back the
 * same way.
 *
 * The calendar hands back local Dates, and the URL carries civil days. Going
 * through `toISOString` would shift both directions by the browser's offset,
 * which is how a picker ends up selecting the day before the one that was
 * clicked for everyone west of UTC.
 */
function fromIsoDay(value?: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toIsoDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * An arbitrary window for the stats screen, beside the presets. Like them it
 * lives in the URL (`?from=&to=`), so the server re-aggregates and the view
 * stays shareable.
 *
 * The range is only applied on the button, not on every click: a range
 * selection passes through a one-day state on its way to two, and applying
 * that would reload the page under the user mid-gesture.
 */
export function StatsRangePicker({ from, to }: RangePickerProps) {
  const t = useTranslations("stats");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const active = Boolean(from && to);
  const selected = fromIsoDay(from)
    ? { from: fromIsoDay(from), to: fromIsoDay(to) }
    : undefined;
  const [draft, setDraft] = useState<DateRange | undefined>(selected);

  const dateFmt = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  });

  // Two months ending on the current one. Opening on today as the *first*
  // month would pair it with a month entirely in the future, where every day
  // is disabled — half the calendar would be dead on arrival.
  const openingMonth = new Date();
  openingMonth.setDate(1);
  openingMonth.setMonth(openingMonth.getMonth() - 1);

  function apply() {
    if (!draft?.from) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", toIsoDay(draft.from));
    // A single click is a one-day range rather than an unfinished one.
    params.set("to", toIsoDay(draft.to ?? draft.from));
    // A range and a preset would both claim the screen; the range wins.
    params.delete("period");
    setOpen(false);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function clear() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    setDraft(undefined);
    setOpen(false);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const label =
    active && selected?.from
      ? `${dateFmt.format(selected.from)} – ${dateFmt.format(selected.to ?? selected.from)}`
      : t("customRange");

  return (
    <div className="inline-flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("gap-1.5", active && "border-ring")}
          >
            <CalendarDays className="size-4 text-muted-foreground" />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            numberOfMonths={2}
            autoFocus
            defaultMonth={selected?.from ?? openingMonth}
            selected={draft}
            onSelect={setDraft}
            disabled={{ after: new Date() }}
            locale={locale === "fr" ? fr : enUS}
            className="p-2"
          />
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={!active && !draft}
            >
              {t("rangeReset")}
            </Button>
            <Button size="sm" onClick={apply} disabled={!draft?.from}>
              {t("rangeApply")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {active && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t("rangeReset")}
          onClick={clear}
        >
          <X className="size-4 text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}
