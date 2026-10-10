"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Tabs as TabsPrimitive } from "radix-ui";
import { ArrowLeft, History, Keyboard, Settings2, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { sendDeviceCommand } from "@/app/org/[officeId]/admin/devices/actions";
import type { ConsoleCommand } from "@/lib/device/commands";
import type { LiveStatus } from "@/lib/device/live";
import { BadgeZone, DeviceShell, useDeviceShortcuts, type BadgeOption, type Side } from "./device-shell";
import { compareFrames, fetchFrame, PANEL_WIDTH, type MirrorFrame } from "./frame-bits";
import { MirrorScreen, type Mirror } from "./mirror-screen";
import { StatusStrip } from "./status-strip";
import { ConsoleMonitor, type MonitorLine } from "./console-monitor";
import { BoardCard, ControlsCard } from "./console-controls";
import { DeviceSettings, RecentTakes, type Take } from "./device-settings";

interface Props {
  readonly officeId: string;
  readonly device: { id: string; name: string; hardwareId: string; firstItemId: string | null };
  readonly items: { id: string; name: string }[];
  readonly badges: BadgeOption[];
  readonly takes: Take[];
  readonly initial: LiveStatus;
  /** When the server rendered the page: relative times start from it, so hydration matches. */
  readonly renderedAt: string;
  /** The office's, for every time shown: the same on the server and in the browser. */
  readonly timeZone: string;
}

type Command = LiveStatus["commands"][number];

/** The console polls this often while it is visible; it keeps the terminal awake and mirroring. */
const POLL_MS = 1000;
/** How long a key or the badge zone stays lit after a press. */
const FLASH_MS = 700;
/** Feedback per partial refresh of the mirror (BUSY on the case). */
const PASS_MS = 650;
/** SPI clocks the frame in at the start of a refresh. */
const SPI_MS = 250;
const MAX_LINES = 200;
/** Remote taps are 200 × 120; the log shows them in panel pixels. */
const TAP_SCALE = PANEL_WIDTH / 200;

/**
 * One terminal, like the SDK studio shows the emulated one: its panel
 * mirrored live and driven from here (keys, badge, taps), its state, a serial
 * monitor of what the console sent and saw, its board; then its takes and settings.
 */
export function DeviceConsole(props: Props) {
  return (
    <TooltipProvider>
      <Console {...props} />
    </TooltipProvider>
  );
}

function Console({ officeId, device, items, badges, takes, initial, renderedAt, timeZone }: Props) {
  const t = useTranslations("devices.console");
  const format = useFormatter();
  const base = `/org/${officeId}/admin/devices/${device.id}`;
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [tab, setTab] = useState("console");
  const [live, setLive] = useState(initial);
  const [commands, setCommands] = useState<Record<string, Command>>(() =>
    Object.fromEntries(initial.commands.map((command) => [command.id, command])),
  );
  const [events, setEvents] = useState<MonitorLine[]>(() => [
    { id: "opened", at: Date.parse(renderedAt), kind: "link", text: t("log.opened") },
  ]);
  const [clearedAt, setClearedAt] = useState(0);
  const [pressed, setPressed] = useState<Side | "badge" | null>(null);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [mirror, setMirror] = useState<Mirror | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<{ passes: number; spi: boolean } | null>(null);

  const eventId = useRef(0);
  const addEvent = useCallback((kind: MonitorLine["kind"], text: string) => {
    const id = `e${++eventId.current}`;
    setEvents((current) => [{ id, at: Date.now(), kind, text }, ...current].slice(0, MAX_LINES));
  }, []);

  // Relative times tick with the page.
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  // Poll /live while the page is visible: it records that someone watches, so
  // the terminal stays awake, takes commands at once and uploads its screen.
  const failing = useRef(false);
  const poll = useCallback(async () => {
    try {
      const response = await fetch(`${base}/live`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = (await response.json()) as LiveStatus;
      setLive(next);
      setCommands((current) => ({ ...current, ...Object.fromEntries(next.commands.map((c) => [c.id, c])) }));
      if (failing.current) {
        failing.current = false;
        addEvent("link", t("log.pollBack"));
      }
    } catch (error) {
      if (!failing.current) {
        failing.current = true;
        addEvent("error", t("log.pollFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }, [base, addEvent, t]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (!document.hidden) await poll();
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    const visible = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [poll]);

  // What changed between two polls goes to the monitor.
  const seen = useRef(initial);
  useEffect(() => {
    const before = seen.current;
    seen.current = live;
    if (before === live) return;
    if (before.reachable !== live.reachable) addEvent("link", live.reachable ? t("log.reachable") : t("log.unreachable"));
    if (live.firmwareVersion && before.firmwareVersion !== live.firmwareVersion)
      addEvent("system", t("log.firmware", { version: live.firmwareVersion }));
  }, [live, addEvent, t]);

  // Fetch the frame whenever the terminal uploaded a new one; one request at a time.
  const shown = useRef<MirrorFrame | null>(null);
  const fetching = useRef<AbortController | null>(null);
  const failedHash = useRef<string | null>(null);
  const busyTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [fetched, setFetched] = useState(0);
  const wanted = live.frame?.hash ?? null;
  useEffect(() => {
    if (!wanted || shown.current?.hash === wanted || fetching.current || failedHash.current === wanted) return;
    const controller = new AbortController();
    fetching.current = controller;
    fetchFrame(`${base}/frame?h=${encodeURIComponent(wanted)}`, controller.signal)
      .then((frame) => {
        failedHash.current = null;
        const previous = shown.current;
        // A slower answer must not replace a newer frame.
        if (previous && previous.drawnAt > frame.drawnAt) return;
        shown.current = frame;
        if (previous?.hash === frame.hash) return;
        const change = previous ? compareFrames(previous.bits, frame.bits) : null;
        setMirror({ frame, change: change && { ...change, at: Date.now() } });
        if (!previous) {
          addEvent("screen", t("log.firstFrame", { when: format.relativeTime(new Date(frame.drawnAt), new Date()) }));
          return;
        }
        if (!change) return;
        const { box, percent, passes } = change;
        addEvent(
          "screen",
          t("log.refresh", { width: box.width, height: box.height, x: box.x, y: box.y, percent, passes }),
        );
        busyTimers.current.forEach(clearTimeout);
        setBusy({ passes, spi: true });
        busyTimers.current = [
          setTimeout(() => setBusy((current) => current && { ...current, spi: false }), SPI_MS),
          setTimeout(() => setBusy(null), passes * PASS_MS),
        ];
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        failedHash.current = wanted;
        addEvent("error", t("log.frameFailed", { error: error instanceof Error ? error.message : String(error) }));
      })
      .finally(() => {
        fetching.current = null;
        // The terminal may have uploaded another frame meanwhile: look again.
        setFetched((count) => count + 1);
      });
  }, [wanted, fetched, base, addEvent, t, format]);
  useEffect(
    () => () => {
      fetching.current?.abort();
      busyTimers.current.forEach(clearTimeout);
    },
    [],
  );

  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const send = useCallback(
    (command: ConsoleCommand) => {
      if (command.kind === "key" || command.kind === "badge") {
        setPressed(command.kind === "key" ? command.side : "badge");
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setPressed(null), FLASH_MS);
      }
      sendDeviceCommand(officeId, device.id, command)
        .then((result) => {
          if (!result.success) {
            toast.error(result.error);
            addEvent("error", result.error);
            return;
          }
          // Listed at once as waiting; the next poll says when the terminal took it.
          setCommands((current) => ({ ...current, [result.command.id]: current[result.command.id] ?? result.command }));
        })
        .catch(() => {
          toast.error(t("sendFailed"));
          addEvent("error", t("sendFailed"));
        });
    },
    [officeId, device.id, addEvent, t],
  );

  const shortcuts = useMemo(
    () => ({
      key: (side: Side) => send({ kind: "key", side }),
      badge: () => setBadgeOpen(true),
      sync: () => send({ kind: "sync" }),
    }),
    [send],
  );
  // Only on the console: arrows in the settings must not press the terminal's keys.
  useDeviceShortcuts(shortcuts, badgeOpen || tab !== "console");

  const describe = useCallback(
    (command: Command): string => {
      switch (command.kind) {
        case "KEY": {
          const tap = /^tap:(\d+):(\d+)$/.exec(command.arg ?? "");
          if (tap) return t("kind.tap", { x: Number(tap[1]) * TAP_SCALE, y: Number(tap[2]) * TAP_SCALE });
          return command.arg === "right" ? t("kind.keyRight") : t("kind.keyLeft");
        }
        case "BADGE":
          return t("kind.badge", { uid: command.arg ?? "" });
        case "SYNC":
          if (command.arg === "app:mate") return t("kind.app", { app: "maté" });
          if (command.arg === "app:showcase") return t("kind.app", { app: "Showcase" });
          return t("kind.sync");
        case "RESTART":
          return t("kind.restart");
        case "FORGET_WIFI":
          return t("kind.forgetWifi");
      }
    },
    [t],
  );
  const lines = useMemo(() => {
    const sent: MonitorLine[] = Object.values(commands).map((command) => ({
      id: command.id,
      at: Date.parse(command.createdAt),
      kind: command.kind === "KEY" || command.kind === "BADGE" ? "input" : "system",
      text: describe(command),
      status: command.status,
    }));
    return [...sent, ...events]
      .filter((line) => line.at > clearedAt)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_LINES);
  }, [commands, events, clearedAt, describe]);

  const waiting = live.commands.filter((c) => c.status === "waiting").length;
  const active = new Set<number>();
  if (pressed === "left") active.add(5);
  if (pressed === "right") active.add(8);
  if (pressed === "badge") [43, 44].forEach((gpio) => active.add(gpio));
  if (busy) active.add(3);
  if (busy?.spi) [2, 4, 7, 9].forEach((gpio) => active.add(gpio));

  return (
    <TabsPrimitive.Root value={tab} onValueChange={setTab} className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/org/${officeId}/admin/devices`}>
            <ArrowLeft /> {t("back")}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{device.name}</h1>
          <Badge variant={live.reachable ? "outline" : "secondary"} className="gap-1.5">
            <span className={cn("size-1.5 rounded-full", live.reachable ? "bg-emerald-500" : "bg-zinc-400")} />
            {live.reachable ? t("live") : t("offline")}
          </Badge>
          {waiting > 0 && <Badge variant="secondary">{t("waiting", { count: waiting })}</Badge>}
          <TabsPrimitive.List className="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground sm:ml-auto">
            <TabTrigger value="console" icon={<SquareTerminal />} label={t("tabs.console")} />
            <TabTrigger
              value="activity"
              icon={<History />}
              label={t("tabs.activity")}
              count={takes.length > 0 ? takes.length : undefined}
            />
            <TabTrigger value="settings" icon={<Settings2 />} label={t("tabs.settings")} />
          </TabsPrimitive.List>
        </div>
      </div>

      <StatusStrip live={live} now={now} timeZone={timeZone} />

      {/*
        Laid out on the room the page leaves (the sidebar takes some): the controls go beside
        the panel only when it still gets 800 px there, else under it, beside the monitor.
      */}
      <TabsPrimitive.Content value="console" className="@container outline-none">
        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3 @3xl:col-span-2 @min-[75rem]:col-span-1">
            <DeviceShell
              pressed={pressed === "left" || pressed === "right" ? pressed : null}
              onKey={(side) => send({ kind: "key", side })}
              indicator={
                <Indicator
                  busy={busy?.passes ?? null}
                  mirror={mirror}
                  preview={preview}
                  reachable={live.reachable}
                  relative={(iso) => format.relativeTime(new Date(iso), now)}
                  onHidePreview={() => setPreview(false)}
                />
              }
              screen={
                <MirrorScreen
                  mirror={mirror}
                  reachable={live.reachable}
                  preview={preview}
                  previewUrl={`${base}/screen`}
                  onPreview={() => setPreview(true)}
                  onTap={(x, y) => send({ kind: "tap", x, y })}
                />
              }
              badge={
                <BadgeZone
                  badges={badges}
                  open={badgeOpen}
                  onOpenChange={setBadgeOpen}
                  flashing={pressed === "badge"}
                  onBadge={(uid) => send({ kind: "badge", uid })}
                />
              }
            />
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Keyboard className="hidden size-3.5 shrink-0 sm:block" /> {t("shortcuts")} {t("tapHint")}
            </p>
          </div>

          <div className="space-y-4 @3xl:col-start-2 @3xl:row-start-2 @min-[75rem]:row-span-2 @min-[75rem]:row-start-1">
            <ControlsCard
              deviceName={device.name}
              reachable={live.reachable}
              onKey={(side) => send({ kind: "key", side })}
              onBoth={() => send({ kind: "both" })}
              onBadge={(uid) => send({ kind: "badge", uid })}
              onSync={(app) => send(app ? { kind: "sync", app } : { kind: "sync" })}
              onRestart={() => send({ kind: "restart" })}
              onForgetWifi={() => send({ kind: "forgetWifi" })}
            />
            <BoardCard hardwareId={device.hardwareId} firmwareVersion={live.firmwareVersion} active={active} />
          </div>

          <div className="min-w-0 @3xl:col-start-1 @3xl:row-start-2">
            <ConsoleMonitor lines={lines} timeZone={timeZone} onClear={() => setClearedAt(Date.now())} />
          </div>
        </div>
      </TabsPrimitive.Content>

      <TabsPrimitive.Content value="activity" className="outline-none">
        <RecentTakes takes={takes} timeZone={timeZone} />
      </TabsPrimitive.Content>

      <TabsPrimitive.Content value="settings" className="outline-none">
        <DeviceSettings officeId={officeId} device={device} items={items} />
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  );
}

function TabTrigger({
  value,
  icon,
  label,
  count,
}: {
  value: string;
  icon: ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="inline-flex h-full items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 [&_svg]:size-4"
    >
      {icon}
      {label}
      {count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
    </TabsPrimitive.Trigger>
  );
}

/** On the case above the panel, like the studio's BUSY: a refresh, or what the panel shows. */
function Indicator({
  busy,
  mirror,
  preview,
  reachable,
  relative,
  onHidePreview,
}: {
  busy: number | null;
  mirror: Mirror | null;
  preview: boolean;
  reachable: boolean;
  relative: (iso: string) => string;
  onHidePreview: () => void;
}) {
  const t = useTranslations("devices.console.indicator");
  const text = "text-[10px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400";
  if (busy !== null)
    return (
      <span className="rounded bg-zinc-900 px-1.5 font-mono text-[10px] leading-4 tracking-widest text-amber-300 uppercase">
        {t("busy", { passes: busy })}
      </span>
    );
  if (!mirror && preview)
    return (
      <>
        <span className={text}>{t("preview")}</span>
        <button
          type="button"
          onClick={onHidePreview}
          className={cn(text, "underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200")}
        >
          {t("hidePreview")}
        </button>
      </>
    );
  if (!mirror) return null;
  return (
    <span className={text} suppressHydrationWarning>
      {reachable ? t("mirror", { when: relative(mirror.frame.drawnAt) }) : t("last", { when: relative(mirror.frame.drawnAt) })}
    </span>
  );
}

