"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Check, Eraser, SquareTerminal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** What the console saw happen: commands it sent with their delivery, and what it noticed. */
export type MonitorLine = {
  id: string;
  /** Epoch milliseconds. */
  at: number;
  kind: "input" | "system" | "screen" | "link" | "error";
  text: string;
  /** For a command: whether the terminal picked it up. */
  status?: "waiting" | "delivered" | "dropped";
};

const KIND_STYLE: Record<MonitorLine["kind"], string> = {
  input: "text-amber-300",
  system: "text-sky-300",
  screen: "text-zinc-400",
  link: "text-emerald-300",
  error: "text-red-300",
};

/**
 * The console's serial monitor, like the SDK studio's: newest first,
 * monospace, each command with whether the terminal received it.
 */
export function ConsoleMonitor({
  lines,
  timeZone,
  onClear,
}: Readonly<{
  lines: MonitorLine[];
  timeZone: string;
  onClear: () => void;
}>) {
  const t = useTranslations("devices.console.monitor");
  const format = useFormatter();
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-300">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2 text-xs">
        <SquareTerminal className="size-3.5 text-zinc-500" />
        <h2 className="font-medium text-zinc-200">{t("title")}</h2>
        <span className="text-zinc-500">{t("count", { count: lines.length })}</span>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 dark:hover:bg-zinc-800"
          onClick={onClear}
          disabled={lines.length === 0}
        >
          <Eraser /> {t("clear")}
        </Button>
      </header>
      {/* Sized by its column, never by its lines: at least 18 rem, more when the row is taller. */}
      <ol role="log" className="min-h-72 flex-1 overflow-y-auto px-4 py-2 font-mono text-xs leading-5 [contain:size]">
        {lines.length === 0 && <li className="text-zinc-600">{t("empty")}</li>}
        {lines.map((line) => (
          <li
            key={line.id}
            className={cn(
              "grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-0.5 sm:grid-cols-[4.5rem_5.5rem_minmax(0,1fr)_auto] sm:py-0",
              line.status === "dropped" && "opacity-50",
            )}
          >
            <time dateTime={new Date(line.at).toISOString()} className="text-zinc-600 tabular-nums" suppressHydrationWarning>
              {format.dateTime(new Date(line.at), {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZone,
              })}
            </time>
            <span className={cn("truncate", KIND_STYLE[line.kind])}>{t(`kind.${line.kind}`)}</span>
            {/* On a phone the text goes under its time, kind and status. */}
            <span
              className={cn(
                "order-last col-span-3 break-words sm:order-none sm:col-span-1",
                line.kind === "error" ? "text-red-300" : "text-zinc-200",
              )}
            >
              {line.text}
            </span>
            {line.status ? <Delivery status={line.status} /> : <span />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Delivery({ status }: Readonly<{ status: NonNullable<MonitorLine["status"]> }>) {
  const t = useTranslations("devices.console.status");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 text-[10px] leading-4",
        status === "waiting" ? "border-zinc-600 text-zinc-200" : "border-zinc-800 text-zinc-500",
      )}
    >
      {status === "waiting" && <span className="size-1.5 animate-pulse rounded-full bg-amber-300" />}
      {status === "delivered" && <Check className="size-3" />}
      {status === "dropped" && <X className="size-3" />}
      {t(status)}
    </span>
  );
}
