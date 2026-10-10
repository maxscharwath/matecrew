"use client";

import { useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CircleAlert, LoaderCircle, MemoryStick, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemorySample } from "./device-log";
import { RailCard } from "./workbench";

type Metric = "internal" | "largest" | "psram" | "stackMin";

const KB = 1024;
/**
 * Where each reading starts to worry, in bytes. Internal RAM: the Wi-Fi failed its timers under
 * 40 KB (device/CLAUDE.md). Stack: the purchases screen overflowed with 2.4 KB left.
 */
const LIMITS: Record<Metric, { warning: number; critical: number }> = {
  internal: { warning: 60 * KB, critical: 40 * KB },
  largest: { warning: 16 * KB, critical: 8 * KB },
  psram: { warning: 1024 * KB, critical: 512 * KB },
  stackMin: { warning: 6 * KB, critical: 3 * KB },
};
const METRICS: Metric[] = ["internal", "largest", "stackMin", "psram"];

type Level = "ok" | "warning" | "critical";

function level(metric: Metric, bytes: number): Level {
  if (bytes < LIMITS[metric].critical) return "critical";
  return bytes < LIMITS[metric].warning ? "warning" : "ok";
}

/**
 * The terminal's free memory over time, from the `heap:` lines it logs after each drawing:
 * a tile per reading with its trend, the lowest seen and a warning near the limits.
 */
export function MemoryCard({
  samples,
  state,
  action,
  timeZone,
}: Readonly<{
  samples: readonly MemorySample[];
  /** `bluetooth`: no paired terminal, the readings come over Bluetooth only. */
  state: "live" | "bluetooth";
  /** Next to the empty state: how to connect. */
  action?: ReactNode;
  timeZone?: string;
}>) {
  const t = useTranslations("devices.console.memory");
  const latest = samples.at(-1);
  return (
    <RailCard
      icon={<MemoryStick />}
      title={t("title")}
      description={latest ? t("readings", { count: samples.length }) : undefined}
    >
      {state === "bluetooth" && (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>{t("needsBluetooth")}</p>
          {action}
        </div>
      )}
      {state === "live" && !latest && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 shrink-0 animate-spin" /> {t("waiting")}
        </p>
      )}
      {state === "live" && latest && (
        <div className="grid grid-cols-2 gap-2">
          {METRICS.map((metric) => (
            <MemoryTile key={metric} metric={metric} samples={samples} timeZone={timeZone} />
          ))}
        </div>
      )}
    </RailCard>
  );
}

function MemoryTile({
  metric,
  samples,
  timeZone,
}: Readonly<{ metric: Metric; samples: readonly MemorySample[]; timeZone?: string }>) {
  const t = useTranslations("devices.console.memory");
  const format = useFormatter();
  const [hover, setHover] = useState<number | null>(null);
  const values = samples.map((sample) => sample[metric]);
  const index = hover ?? values.length - 1;
  const value = values[index];
  const lowest = Math.min(...values);
  const state = level(metric, value);

  const bytes = (amount: number) =>
    amount >= 1024 * KB
      ? t("mb", { value: format.number(amount / (1024 * KB), { maximumFractionDigits: 2 }) })
      : t("kb", { value: format.number(amount / KB, { maximumFractionDigits: 1 }) });

  let detail = metric === "stackMin" ? t("sinceBoot") : t("lowest", { value: bytes(lowest) });
  if (hover !== null) {
    detail = format.dateTime(new Date(samples[index].at), { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone });
  }

  return (
    <div className="min-w-0 rounded-lg border bg-muted/30 p-2.5">
      <div className="truncate text-xs text-muted-foreground" title={t(`hints.${metric}`)}>
        {t(`metrics.${metric}`)}
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-1">
        <span className="text-base font-semibold">{bytes(value)}</span>
        {state !== "ok" && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-0.5 text-[11px] font-medium",
              state === "critical" ? "text-destructive" : "text-amber-600 dark:text-amber-400",
            )}
          >
            {state === "critical" ? <CircleAlert className="size-3" /> : <TriangleAlert className="size-3" />}
            {t(`levels.${state}`)}
          </span>
        )}
      </div>
      <Sparkline values={values} highlight={index} onHover={setHover} label={t(`metrics.${metric}`)} />
      <div className="truncate text-[11px] text-muted-foreground" suppressHydrationWarning>
        {detail}
      </div>
    </div>
  );
}

const WIDTH = 100;
const HEIGHT = 28;

/** A reading's recent values as a line, the shown one marked; hovering picks a value. */
function Sparkline({
  values,
  highlight,
  onHover,
  label,
}: Readonly<{ values: number[]; highlight: number; onHover: (index: number | null) => void; label: string }>) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const x = (i: number) => (values.length < 2 ? WIDTH : (i / (values.length - 1)) * WIDTH);
  // A flat series sits in the middle; otherwise it fills the height with a pixel of room.
  const y = (v: number) => (span === 0 ? HEIGHT / 2 : 2 + (1 - (v - min) / span) * (HEIGHT - 4));
  const points = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  return (
    <div
      role="img"
      aria-label={label}
      className="relative my-1.5 h-7 cursor-crosshair touch-none"
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
        onHover(Math.round(ratio * (values.length - 1)));
      }}
      onPointerLeave={() => onHover(null)}
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="text-muted-foreground/50"
        />
      </svg>
      <span
        className="absolute size-2 -translate-1/2 rounded-full bg-foreground ring-2 ring-card"
        style={{ left: `${(x(highlight) / WIDTH) * 100}%`, top: `${(y(values[highlight]) / HEIGHT) * 100}%` }}
      />
    </div>
  );
}
