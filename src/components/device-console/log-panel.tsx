"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDownToLine, Check, Copy, Download, Eraser, ScrollText, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { logText, type ConsoleKind, type LogEntry, type LogLevel } from "./device-log";

type Filter = "all" | "device" | "console" | "problems";
const FILTERS: Filter[] = ["all", "device", "console", "problems"];

const LEVEL_STYLE: Record<LogLevel, string> = {
  E: "bg-red-500/20 text-red-300",
  W: "bg-amber-500/20 text-amber-300",
  I: "text-zinc-400",
  D: "text-zinc-600",
  V: "text-zinc-600",
};

const KIND_STYLE: Record<ConsoleKind, string> = {
  input: "text-amber-300",
  system: "text-sky-300",
  screen: "text-zinc-500",
  link: "text-emerald-300",
  error: "text-red-300",
};

/** Within this many pixels of the bottom, the log follows new lines. */
const STICK_PX = 24;

const isProblem = (entry: LogEntry) => entry.level === "E" || entry.level === "W" || entry.status === "dropped";

/**
 * A terminal's log like a serial monitor: oldest first, following new lines until scrolled up.
 * The firmware's own lines (over Bluetooth) and what the console sent and saw share it, with
 * filters, a search, a copy and a download.
 */
export function LogPanel({
  entries,
  timeZone,
  fileName,
  onClear,
  notice,
  className,
}: Readonly<{
  /** Oldest first. */
  entries: readonly LogEntry[];
  timeZone?: string;
  /** The download's name, before its date. */
  fileName: string;
  onClear: () => void;
  /** Under the lines: why the terminal's own log does not come, and how to get it. */
  notice?: ReactNode;
  className?: string;
}>) {
  const t = useTranslations("devices.console.logs");
  const format = useFormatter();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [stuck, setStuck] = useState(true);
  const list = useRef<HTMLOListElement>(null);

  const time = (at: number) =>
    format.dateTime(new Date(at), { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone });

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === "device" && entry.source !== "device") return false;
      if (filter === "console" && entry.source !== "console") return false;
      if (filter === "problems" && !isProblem(entry)) return false;
      return !needle || entry.text.toLowerCase().includes(needle) || entry.tag.toLowerCase().includes(needle);
    });
  }, [entries, filter, query]);
  const counts = useMemo(
    () => ({
      all: entries.length,
      device: entries.filter((entry) => entry.source === "device").length,
      console: entries.filter((entry) => entry.source === "console").length,
      problems: entries.filter(isProblem).length,
    }),
    [entries],
  );

  // Follows the newest line unless the reader scrolled up to look at older ones.
  useLayoutEffect(() => {
    if (stuck && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [shown, stuck]);

  const copy = () => {
    void navigator.clipboard.writeText(logText(shown, time)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => toast.error(t("copyFailed")));
  };

  const download = () => {
    const blob = new Blob([`${logText(shown, time)}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}-${new Date().toISOString().slice(0, 19).replaceAll(":", "")}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const toolButton = "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 dark:hover:bg-zinc-800";

  return (
    <section
      className={cn(
        "relative flex h-[28rem] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-300",
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-800 px-3 py-2 text-xs">
        <h2 className="flex items-center gap-2 pl-1 font-medium text-zinc-200">
          <ScrollText className="size-3.5 text-zinc-500" /> {t("title")}
        </h2>
        <div role="tablist" aria-label={t("filter")} className="flex items-center rounded-md bg-zinc-900 p-0.5">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded px-2 text-zinc-400 outline-none hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-600",
                filter === value && "bg-zinc-800 text-zinc-100",
              )}
            >
              {t(`filters.${value}`)}
              <span className={cn("tabular-nums text-zinc-500", value === "problems" && counts.problems > 0 && "text-amber-300")}>
                {counts[value]}
              </span>
            </button>
          ))}
        </div>
        <label className="flex h-7 min-w-36 flex-1 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2 focus-within:border-zinc-600 sm:max-w-56">
          <Search className="size-3.5 shrink-0 text-zinc-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            spellCheck={false}
            className="w-full min-w-0 bg-transparent text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          {query && (
            <button type="button" aria-label={t("clearSearch")} onClick={() => setQuery("")} className="text-zinc-500 hover:text-zinc-200">
              <X className="size-3.5" />
            </button>
          )}
        </label>
        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" size="icon-xs" className={toolButton} onClick={copy} disabled={shown.length === 0} aria-label={t("copy")} title={t("copy")}>
            {copied ? <Check /> : <Copy />}
          </Button>
          <Button variant="ghost" size="icon-xs" className={toolButton} onClick={download} disabled={shown.length === 0} aria-label={t("download")} title={t("download")}>
            <Download />
          </Button>
          <Button variant="ghost" size="icon-xs" className={toolButton} onClick={onClear} disabled={entries.length === 0} aria-label={t("clear")} title={t("clear")}>
            <Eraser />
          </Button>
        </div>
      </header>

      <ol
        ref={list}
        role="log"
        onScroll={(event) => {
          const element = event.currentTarget;
          setStuck(element.scrollHeight - element.scrollTop - element.clientHeight < STICK_PX);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-5"
      >
        {shown.length === 0 && (
          <li className="py-1 text-zinc-600">{entries.length === 0 ? t("empty") : t("emptyFiltered")}</li>
        )}
        {shown.map((entry) => (
          <LogLine key={entry.id} entry={entry} time={time(entry.at)} />
        ))}
      </ol>

      {!stuck && (
        <Button
          size="xs"
          variant="secondary"
          className="absolute right-4 bottom-14 shadow-lg"
          onClick={() => setStuck(true)}
        >
          <ArrowDownToLine /> {t("latest")}
        </Button>
      )}

      {notice && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-800 bg-zinc-900/60 px-4 py-2 text-xs text-zinc-400">
          {notice}
        </div>
      )}
    </section>
  );
}

function LogLine({ entry, time }: Readonly<{ entry: LogEntry; time: string }>) {
  const t = useTranslations("devices.console.logs");
  const consoleKind = entry.source === "console" ? (entry.tag as ConsoleKind) : null;
  return (
    <li
      className={cn(
        "grid grid-cols-[4.25rem_1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2 sm:grid-cols-[4.25rem_1.25rem_5rem_minmax(0,1fr)_auto]",
        entry.status === "dropped" && "opacity-50",
      )}
    >
      <time dateTime={new Date(entry.at).toISOString()} className="text-zinc-600 tabular-nums" suppressHydrationWarning>
        {time}
      </time>
      <span className={cn("rounded text-center text-[10px] leading-4 font-semibold", LEVEL_STYLE[entry.level])}>{entry.level}</span>
      <span className={cn("hidden truncate sm:block", consoleKind ? KIND_STYLE[consoleKind] : "text-sky-300/80")}>
        {consoleKind ? t(`kind.${consoleKind}`) : entry.tag}
      </span>
      <span className={cn("break-words whitespace-pre-wrap", entry.level === "E" ? "text-red-300" : "text-zinc-200")}>
        {entry.text}
      </span>
      {entry.status ? <Delivery status={entry.status} /> : <span />}
    </li>
  );
}

function Delivery({ status }: Readonly<{ status: NonNullable<LogEntry["status"]> }>) {
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
