"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Tabs as TabsPrimitive } from "radix-ui";
import {
  Activity,
  ArrowLeft,
  Battery,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Bluetooth,
  BluetoothConnected,
  BluetoothSearching,
  Clock,
  Cpu,
  Hash,
  History,
  LoaderCircle,
  MonitorSmartphone,
  Moon,
  Radio,
  Settings2,
  SquareTerminal,
  Timer,
  Wifi,
  WifiHigh,
  WifiLow,
  WifiOff,
  WifiZero,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { consoleSocket, sendDeviceCommand } from "@/app/org/[officeId]/admin/devices/actions";
import { fromWire, toRemote, toRow, withId, type ConsoleCommand } from "@/lib/device/console-commands";
import type { LiveStatus } from "@/lib/device/live";
import type { CommandEntry, TerminalStatus } from "../../../realtime/src/protocol";
import type { BadgeOption } from "./device-shell";
import { compareFrames, fetchFrame, type MirrorFrame } from "./frame-bits";
import { MirrorScreen, type Mirror } from "./mirror-screen";
import { LogPanel } from "./log-panel";
import { MemoryCard } from "./memory-panel";
import { ActionsCard } from "./terminal-actions";
import { BoardCard } from "./board-card";
import { FactList, RailCard, Workbench, type Fact } from "./workbench";
import type { LogEntry } from "./device-log";
import { battery, signalBand } from "./readings";
import { DeviceSettings, RecentTakes, type DeviceSettingsProps, type Take } from "./device-settings";
import { useBleScreen, useBleSession, useBleTerminal, type BleTerminal } from "./ble-link";
import { useRelay, type RelaySocket } from "./relay-link";
import { commandKind, TerminalPanel, useCommandLabels, useConsoleLog, useTerminalControls } from "./terminal-controls";
import { SoundButton, useConsoleBuzzer } from "./console-buzzer";
import type { Tone } from "../../../realtime/src/protocol";
import type { MemorySample } from "./device-log";

interface Props {
  readonly officeId: string;
  readonly device: DeviceSettingsProps["device"] & { hardwareId: string };
  /** What a terminal without its own language and theme shows: its office's, the site's. */
  readonly display: DeviceSettingsProps["display"];
  readonly items: { id: string; name: string }[];
  readonly badges: BadgeOption[];
  readonly takes: Take[];
  readonly initial: LiveStatus;
  /** The terminal's relay socket for this console; null without a relay: the console polls. */
  readonly relay: RelaySocket | null;
  /** When the server rendered the page: relative times start from it, so hydration matches. */
  readonly renderedAt: string;
  /** The office's, for every time shown: the same on the server and in the browser. */
  readonly timeZone: string;
}

type Command = LiveStatus["commands"][number];

/** Without a relay, the console polls this often while it is visible; it keeps the terminal awake and mirroring. */
const POLL_MS = 1000;
/** Commands the status counts as waiting, as /live lists them. */
const LISTED = 8;
/** Feedback per partial refresh of the mirror (BUSY on the case). */
const PASS_MS = 650;
/** SPI clocks the frame in at the start of a refresh. */
const SPI_MS = 250;
/** Lines the log keeps: the console's, the commands', and the terminal's own over Bluetooth. */
const MAX_LINES = 400;

const SIGNAL_ICON = { excellent: Wifi, good: WifiHigh, fair: WifiLow, weak: WifiZero } as const;

/**
 * One terminal, like the SDK studio shows the emulated one: its panel mirrored live and driven
 * from here (keys, badge reader, taps), its status, memory and actions beside it, its log under
 * it; then its takes and settings. Nearby, over Bluetooth, the panel comes straight from the
 * terminal, the commands go straight to it and its own log and memory show; through the site
 * otherwise.
 */
export function DeviceConsole(props: Props) {
  return (
    <TooltipProvider>
      <Console {...props} />
    </TooltipProvider>
  );
}

function Console({ officeId, device, display, items, badges, takes, initial, relay, renderedAt, timeZone }: Props) {
  const t = useTranslations("devices.console");
  const format = useFormatter();
  const base = `/org/${officeId}/admin/devices/${device.id}`;
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [tab, setTab] = useState("console");
  const [live, setLive] = useState(initial);
  const [commands, setCommands] = useState<Record<string, Command>>(() =>
    Object.fromEntries(initial.commands.map((command) => [command.id, command])),
  );
  const { events, addEvent, clearedAt, clear } = useConsoleLog({
    id: "opened",
    at: Date.parse(renderedAt),
    source: "console",
    level: "I",
    tag: "link",
    text: t("log.opened"),
  });
  const [mirror, setMirror] = useState<Mirror | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<{ passes: number; spi: boolean } | null>(null);

  // The terminal over Bluetooth, when connected from here: its screen, and a shorter way for commands.
  const ble = useBleTerminal(device.hardwareId, {
    connected: (name) => addEvent("link", t("log.bleConnected", { name })),
    mismatch: (name) => {
      toast.error(t("ble.mismatch", { name }));
      addEvent("error", t("ble.mismatch", { name }));
    },
    failed: (error) => {
      toast.error(t("ble.failed", { message: error.message }));
      addEvent("error", t("ble.failed", { message: error.message }));
    },
    disconnected: () => addEvent("link", t("log.bleDisconnected")),
  });
  const { frame: bleFrame, error: bleError } = useBleScreen(ble.device);
  const bleLive = bleFrame !== null;
  // Its own log, memory and info, which only Bluetooth carries.
  const session = useBleSession(ble.device);
  useEffect(() => {
    if (bleError && bleError.code !== "disconnected") addEvent("error", t("ble.screenFailed", { message: bleError.message }));
  }, [bleError, addEvent, t]);

  // Relative times tick with the page.
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  // Without a relay, poll /live while the page is visible: it records that someone watches, so
  // the terminal stays awake, takes commands at once and uploads its screen;
  // not the screen while it comes over Bluetooth.
  const failing = useRef(false);
  const poll = useCallback(async () => {
    try {
      const response = await fetch(`${base}/live${bleLive ? "?watch=0" : ""}`, { cache: "no-store" });
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
  }, [base, bleLive, addEvent, t]);
  usePolling(poll, !relay);

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

  // Shows a frame from either way, and how the panel went from the one before.
  const shown = useRef<MirrorFrame | null>(null);
  const shownVia = useRef<Mirror["via"]>("wifi");
  const busyTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const present = useCallback(
    (frame: MirrorFrame, via: Mirror["via"]) => {
      const previous = shown.current;
      // A slower answer must not replace a newer frame; the two ways' clocks are not compared.
      if (previous && via === "wifi" && shownVia.current === "wifi" && previous.drawnAt > frame.drawnAt) return;
      if (via === "bluetooth" && shownVia.current !== "bluetooth") addEvent("link", t("log.bleScreen"));
      shown.current = frame;
      shownVia.current = via;
      if (previous?.hash === frame.hash) return;
      const change = previous ? compareFrames(previous.bits, frame.bits) : null;
      setMirror({ frame, change: change && { ...change, at: Date.now() }, via });
      if (!previous) {
        addEvent("screen", t("log.firstFrame", { when: format.relativeTime(new Date(frame.drawnAt), new Date()) }));
        return;
      }
      if (!change) return;
      const { box, percent, passes } = change;
      addEvent("screen", t("log.refresh", { width: box.width, height: box.height, x: box.x, y: box.y, percent, passes }));
      busyTimers.current.forEach(clearTimeout);
      setBusy({ passes, spi: true });
      busyTimers.current = [
        setTimeout(() => setBusy((current) => current && { ...current, spi: false }), SPI_MS),
        setTimeout(() => setBusy(null), passes * PASS_MS),
      ];
    },
    [addEvent, t, format],
  );

  // Over Bluetooth, each screen as it comes.
  useEffect(() => {
    if (bleFrame) present(bleFrame, "bluetooth");
  }, [bleFrame, present]);

  // With the relay, everything is pushed: presence, status, commands, the terminal's log, its
  // screen, its beeps.
  const buzzer = useConsoleBuzzer(ble.device, bleLive, relay !== null);
  const { link: relayLink, logs: relayLogs, memory: relayMemory, clearLogs: clearRelayLogs } = useLiveRelay({
    relay,
    renew: () => consoleSocket(officeId, device.id),
    screen: !bleLive,
    setLive,
    setCommands,
    present,
    onConnection: (open) => addEvent("link", open ? t("log.relayOpen") : t("log.relayClosed")),
    onBeep: buzzer.play,
  });

  // Without a relay, fetch the frame whenever the terminal uploaded a new one; one request at a time.
  const fetching = useRef<AbortController | null>(null);
  const failedHash = useRef<string | null>(null);
  const [fetched, setFetched] = useState(0);
  const wanted = live.frame?.hash ?? null;
  useEffect(() => {
    if (relay || bleLive || !wanted || shown.current?.hash === wanted || fetching.current || failedHash.current === wanted) return;
    const controller = new AbortController();
    fetching.current = controller;
    fetchFrame(`${base}/frame?h=${encodeURIComponent(wanted)}`, controller.signal)
      .then((frame) => {
        failedHash.current = null;
        present(frame, "wifi");
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
  }, [wanted, fetched, relay, bleLive, base, present, addEvent, t]);
  useEffect(
    () => () => {
      fetching.current?.abort();
      busyTimers.current.forEach(clearTimeout);
    },
    [],
  );

  const { describe, describeRow } = useCommandLabels();

  const sendViaSite = useCallback(
    (command: ConsoleCommand) => {
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

  // Over the relay's socket when it is open (the terminal gets it in a few tens of ms), else through the site.
  const relaySend = relayLink.send;
  const sendLive = useCallback(
    (command: ConsoleCommand) => relaySend(withId(command, crypto.randomUUID())) || sendViaSite(command),
    [relaySend, sendViaSite],
  );

  const route = useCallback(
    (command: ConsoleCommand) => {
      // Paired over Bluetooth (its screen comes): straight to the terminal, else through the site.
      const remote = bleLive ? toRemote(command) : null;
      const target = ble.device;
      if (!remote || !target) return sendLive(command);
      void target.send(remote).then((sent) => {
        if (sent.ok) {
          addEvent(commandKind(command), t("log.viaBluetooth", { what: describe(command) }));
          return;
        }
        addEvent("error", t("ble.sendFailed", { message: sent.error.message }));
        sendLive(command);
      });
    },
    [bleLive, ble.device, sendLive, describe, addEvent, t],
  );
  // Keys, both keys, the reader and the shortcuts; only on the console tab: arrows in the
  // settings must not press the terminal's keys.
  const controls = useTerminalControls(route, tab !== "console");
  const send = controls.press;
  // One log, oldest first: what the console noticed, the commands it sent, the terminal's own lines.
  const deviceLogs = useMemo(() => [...session.logs, ...relayLogs], [session.logs, relayLogs]);
  const lines = useMemo(() => {
    const sent: LogEntry[] = Object.values(commands).map((command) => ({
      id: command.id,
      at: Date.parse(command.createdAt),
      source: "console",
      level: command.status === "dropped" ? "W" : "I",
      tag: command.kind === "KEY" || command.kind === "BADGE" ? "input" : "system",
      text: describeRow(command),
      status: command.status,
    }));
    return [...sent, ...events, ...deviceLogs]
      .filter((line) => line.at > clearedAt)
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_LINES);
  }, [commands, events, deviceLogs, clearedAt, describeRow]);

  const updateOverBluetooth = async (image: Uint8Array, progress: (percent: number) => void) => {
    const target = ble.device;
    if (!target) return;
    addEvent("system", t("log.firmwareSending"));
    const done = await target.updateFirmware(image, { onProgress: (sent, total) => progress(Math.round((sent * 100) / total)) });
    if (done.ok) {
      toast.success(t("log.firmwareSent"));
      addEvent("system", t("log.firmwareSent"));
    } else {
      toast.error(t("ble.failed", { message: done.error.message }));
      addEvent("error", t("ble.failed", { message: done.error.message }));
    }
  };

  const waiting = live.commands.filter((c) => c.status === "waiting").length;
  // The terminal's memory over Bluetooth, else from its log over the relay.
  const memorySamples = [session.memory, relayMemory].find((samples) => samples.length > 0) ?? [];
  const active = new Set<number>();
  if (controls.pressed === "left") active.add(5);
  if (controls.pressed === "right") active.add(8);
  if (controls.pressed === "badge") [43, 44].forEach((gpio) => active.add(gpio));
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
          <LinkBadge live={live} timeZone={timeZone} />
          {ble.supported && <BleButton ble={ble} live={bleLive} />}
          {buzzer.available && <SoundButton buzzer={buzzer} />}
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

      <TabsPrimitive.Content value="console" className="outline-none">
        <Workbench
          terminal={
            <TerminalPanel
              controls={controls}
              badges={badges}
              indicator={
                <Indicator
                  busy={busy?.passes ?? null}
                  mirror={mirror}
                  preview={preview}
                  reachable={live.reachable || bleLive}
                  relative={(iso) => format.relativeTime(new Date(iso), now)}
                  onHidePreview={() => setPreview(false)}
                />
              }
              screen={
                <MirrorScreen
                  mirror={mirror}
                  reachable={live.reachable || bleLive}
                  preview={preview}
                  previewUrl={`${base}/screen`}
                  onPreview={() => setPreview(true)}
                  onTap={(x, y) => send({ kind: "tap", x, y })}
                />
              }
            />
          }
          rail={
            <>
              <RailCard icon={<Activity />} title={t("status.title")}>
                <FactList facts={statusFacts({ t, format, live, now, timeZone, info: session.info, hardwareId: device.hardwareId })} />
              </RailCard>
              <MemoryCard
                samples={memorySamples}
                state={ble.device || relayMemory.length > 0 ? "live" : "bluetooth"}
                timeZone={timeZone}
                action={<BleConnectHint ble={ble} />}
              />
              <ActionsCard
                deviceName={device.name}
                description={live.reachable || bleLive ? t("controls.live") : t("offlineHint")}
                onSync={() => send({ kind: "sync" })}
                onBoth={() => send({ kind: "both" })}
                onOpenApp={(app) => send({ kind: "sync", app })}
                onRestart={() => send({ kind: "restart" })}
                onForgetWifi={() => send({ kind: "forgetWifi" })}
                onFirmware={ble.device ? (image, progress) => updateOverBluetooth(image, progress) : undefined}
              />
              <BoardCard active={active} />
            </>
          }
          logs={
            <LogPanel
              entries={lines}
              timeZone={timeZone}
              fileName={device.name}
              onClear={() => {
                clear();
                session.clearLogs();
                clearRelayLogs();
              }}
              notice={
                ble.device || relayLogs.length > 0 ? undefined : (
                  <>
                    <span className="min-w-0 flex-1">{t("logs.bluetoothNotice")}</span>
                    <BleConnectHint ble={ble} dark />
                  </>
                )
              }
            />
          }
        />
      </TabsPrimitive.Content>

      <TabsPrimitive.Content value="activity" className="outline-none">
        <RecentTakes takes={takes} timeZone={timeZone} />
      </TabsPrimitive.Content>

      <TabsPrimitive.Content value="settings" className="outline-none">
        <DeviceSettings officeId={officeId} device={device} display={display} items={items} />
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  );
}

/** Runs `poll` every POLL_MS while the page is visible and `enabled`, and at once when it shows again. */
function usePolling(poll: () => Promise<void>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
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
  }, [poll, enabled]);
}

/** The console's commands as the relay lists them (`sent` is still on its way: waiting). */
function listedCommands(entries: CommandEntry[]): Command[] {
  return entries.flatMap((entry) => {
    const command = fromWire(entry.command);
    if (!command) return [];
    const status = entry.status === "sent" ? "waiting" : entry.status;
    return [{ id: entry.id, ...toRow(command), createdAt: new Date(entry.at).toISOString(), status } satisfies Command];
  });
}

/** `current` with the terminal's report from `at` (ms) over it. */
function withStatus(current: LiveStatus, status: TerminalStatus, at: number): LiveStatus {
  const seen = Math.max(at, Date.parse(current.lastSeenAt ?? "") || 0);
  return {
    ...current,
    lastSeenAt: seen > 0 ? new Date(seen).toISOString() : current.lastSeenAt,
    batteryMv: typeof status.batteryMv === "number" ? status.batteryMv : current.batteryMv,
    wifiRssi: typeof status.rssi === "number" ? status.rssi : current.wifiRssi,
    firmwareVersion: typeof status.firmware === "string" ? status.firmware : current.firmwareVersion,
  };
}

/** The last LISTED commands, newest first, with `listed` merged in. */
function withCommands(current: LiveStatus, listed: Command[]): LiveStatus {
  const merged = new Map(current.commands.map((c) => [c.id, c]));
  listed.forEach((c) => merged.set(c.id, c));
  const commands = [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, LISTED);
  return { ...current, commands };
}

/** The console's state kept up to date by the relay's socket (`useRelay`). */
function useLiveRelay({
  relay,
  renew,
  screen,
  setLive,
  setCommands,
  present,
  onConnection,
  onBeep,
}: {
  relay: RelaySocket | null;
  renew: () => Promise<RelaySocket | null>;
  screen: boolean;
  setLive: Dispatch<SetStateAction<LiveStatus>>;
  setCommands: Dispatch<SetStateAction<Record<string, Command>>>;
  present: (frame: MirrorFrame, via: Mirror["via"]) => void;
  onConnection: (open: boolean) => void;
  onBeep: (tones: Tone[]) => void;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [memory, setMemory] = useState<MemorySample[]>([]);
  const link = useRelay(
    relay,
    renew,
    {
      online: (online, _since, asleepUntil) =>
        setLive((current) => ({
          ...current,
          reachable: online,
          asleep: !online && asleepUntil !== undefined,
          asleepUntil: typeof asleepUntil === "number" ? new Date(asleepUntil).toISOString() : null,
          lastSeenAt: online ? new Date().toISOString() : current.lastSeenAt,
        })),
      status: (status, at) => setLive((current) => withStatus(current, status, at)),
      commands: (entries) => {
        const listed = listedCommands(entries);
        setCommands((current) => ({ ...current, ...Object.fromEntries(listed.map((c) => [c.id, c])) }));
        setLive((current) => withCommands(current, listed));
      },
      frame: (frame) => {
        setLive((current) => ({ ...current, frame: { hash: frame.hash, drawnAt: frame.drawnAt } }));
        present(frame, "wifi");
      },
      log: (entry, sample) => {
        setLogs((current) => [...current, entry].slice(-MAX_LINES));
        if (sample) setMemory((current) => [...current, sample].slice(-MAX_LINES));
      },
      beep: onBeep,
    },
    screen,
  );
  const clearLogs = useCallback(() => setLogs([]), []);
  const told = useRef(link.connected);
  const tell = useRef(onConnection);
  useEffect(() => {
    tell.current = onConnection;
  });
  useEffect(() => {
    if (link.connected === told.current) return;
    told.current = link.connected;
    tell.current(link.connected);
  }, [link.connected]);
  return { link, logs, memory, clearLogs };
}

/** "En direct", "En veille · réveil à 14:30" or "Hors ligne", times in the office's zone. */
function linkLabel(
  t: ReturnType<typeof useTranslations<"devices.console">>,
  format: ReturnType<typeof useFormatter>,
  live: LiveStatus,
  timeZone: string,
): string {
  if (live.reachable) return t("live");
  if (!live.asleep) return t("offline");
  if (!live.asleepUntil) return t("asleep");
  return t("asleepUntil", { time: format.dateTime(new Date(live.asleepUntil), { hour: "2-digit", minute: "2-digit", timeZone }) });
}

function linkDetail(t: ReturnType<typeof useTranslations<"devices.console">>, live: LiveStatus): string {
  if (live.reachable) return t("strip.linkLive");
  return live.asleep ? t("strip.linkAsleep") : t("strip.linkQueued");
}

/** Its link at a glance: live, asleep (until when), or offline. */
function LinkBadge({ live, timeZone }: Readonly<{ live: LiveStatus; timeZone: string }>) {
  const t = useTranslations("devices.console");
  const format = useFormatter();
  return (
    <Badge variant={live.reachable ? "outline" : "secondary"} className="gap-1.5">
      {live.asleep ? (
        <Moon className="size-3" />
      ) : (
        <span className={cn("size-1.5 rounded-full", live.reachable ? "bg-emerald-500" : "bg-zinc-400")} />
      )}
      {linkLabel(t, format, live, timeZone)}
    </Badge>
  );
}

/** The status bar's battery icon for a charge, or a plain one when there is no battery reading. */
function BatteryGlyph({ charge }: Readonly<{ charge: ReturnType<typeof battery> }>) {
  if (!charge) return <Battery />;
  if (charge.low) return <BatteryWarning />;
  if (charge.percent > 66) return <BatteryFull />;
  if (charge.percent > 33) return <BatteryMedium />;
  return <BatteryLow />;
}

/**
 * The terminal at a glance: link, contact, firmware, battery, Wi-Fi, screen; with Bluetooth,
 * also what only the terminal knows (its slot, network name, uptime).
 */
function statusFacts({
  t,
  format,
  live,
  now,
  timeZone,
  info,
  hardwareId,
}: {
  t: ReturnType<typeof useTranslations<"devices.console">>;
  format: ReturnType<typeof useFormatter>;
  live: LiveStatus;
  now: Date;
  timeZone: string;
  info: ReturnType<typeof useBleSession>["info"];
  hardwareId: string;
}): Fact[] {
  const facts: Fact[] = [
    {
      icon: <Radio />,
      label: t("strip.link"),
      value: (
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", live.reachable ? "bg-emerald-500" : "bg-zinc-400")} />
          {linkLabel(t, format, live, timeZone)}
        </span>
      ),
      detail: linkDetail(t, live),
    },
    {
      icon: <Clock />,
      label: t("strip.lastSeen"),
      value: live.lastSeenAt ? format.relativeTime(new Date(live.lastSeenAt), now) : t("neverSeen"),
      detail: live.lastSeenAt
        ? format.dateTime(new Date(live.lastSeenAt), { dateStyle: "short", timeStyle: "medium", timeZone })
        : undefined,
      muted: !live.lastSeenAt,
    },
    {
      icon: <Cpu />,
      label: t("firmware"),
      value: info?.firmware.version ?? live.firmwareVersion ?? "—",
      detail: info ? [info.firmware.slot, info.firmware.build].filter(Boolean).join(" · ") : undefined,
      mono: true,
      muted: !info && !live.firmwareVersion,
    },
    batteryFact(t, format, live.batteryMv),
    signalFact(t, live.wifiRssi, info),
    {
      icon: <MonitorSmartphone />,
      label: t("strip.screen"),
      value: live.frame ? format.relativeTime(new Date(live.frame.drawnAt), now) : t("strip.screenNone"),
      muted: !live.frame,
    },
  ];
  if (info) {
    const minutes = Math.floor(info.uptime / 60);
    facts.push({
      icon: <Timer />,
      label: t("status.uptime"),
      value: t("status.uptimeValue", { hours: Math.floor(minutes / 60), minutes: minutes % 60 }),
    });
  }
  facts.push({ icon: <Hash />, label: t("hardwareId"), value: hardwareId, mono: true });
  return facts;
}

/** Charge and voltage, with a warning when low. */
function batteryFact(
  t: ReturnType<typeof useTranslations<"devices.console">>,
  format: ReturnType<typeof useFormatter>,
  millivolts: number | null,
): Fact {
  const charge = battery(millivolts);
  if (!charge) return { icon: <BatteryGlyph charge={null} />, label: t("battery"), value: "—", muted: true };
  const volts = `${format.number(charge.millivolts / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} V`;
  return {
    icon: <BatteryGlyph charge={charge} />,
    label: t("battery"),
    value: `${charge.percent} %`,
    detail: charge.low ? [volts, t("strip.batteryLow")].join(" · ") : volts,
    alert: charge.low,
  };
}

/** The network and its signal: the terminal's own reading over Bluetooth, else its last report. */
function signalFact(
  t: ReturnType<typeof useTranslations<"devices.console">>,
  reported: number | null,
  info: ReturnType<typeof useBleSession>["info"],
): Fact {
  const rssi = info?.wifi?.rssi ?? reported;
  if (rssi == null && !info?.wifi) return { icon: <WifiOff />, label: t("signal"), value: "—", muted: true };
  const band = rssi == null ? null : signalBand(rssi);
  const SignalIcon = band ? SIGNAL_ICON[band] : WifiOff;
  const dbm = rssi == null ? null : `${rssi} dBm`;
  const quality = band ? t(`strip.signal.${band}`) : null;
  return {
    icon: <SignalIcon />,
    label: t("signal"),
    value: info?.wifi?.ssid ?? dbm ?? "—",
    detail: [quality, info?.wifi ? dbm : null].filter(Boolean).join(" · ") || undefined,
  };
}

/** Where only Bluetooth helps (memory, the terminal's log): connect, or why this browser cannot. */
function BleConnectHint({ ble, dark = false }: Readonly<{ ble: BleTerminal; dark?: boolean }>) {
  const t = useTranslations("devices.console.ble");
  if (ble.supported === false) return <span className={dark ? "text-zinc-500" : "text-xs"}>{t("unsupported")}</span>;
  return (
    <Button
      variant="outline"
      size="xs"
      disabled={ble.connecting || ble.supported === null}
      onClick={ble.connect}
      className={cn(dark && "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800")}
    >
      {ble.connecting ? <LoaderCircle className="animate-spin" /> : <Bluetooth />}
      {t("connectNearby")}
    </Button>
  );
}

/** Connects to this terminal over Bluetooth, then says how it goes; a click lets it go. */
function BleButton({ ble, live }: Readonly<{ ble: BleTerminal; live: boolean }>) {
  const t = useTranslations("devices.console.ble");
  if (!ble.device)
    return (
      <Button variant="outline" size="xs" disabled={ble.connecting} onClick={ble.connect} title={t("connectHint")}>
        {ble.connecting ? <LoaderCircle className="animate-spin" /> : <Bluetooth />}
        {t("connect")}
      </Button>
    );
  return (
    <Button variant="outline" size="xs" onClick={ble.disconnect} title={t("disconnect")}>
      {live ? <BluetoothConnected className="text-sky-600" /> : <BluetoothSearching className="animate-pulse" />}
      {live ? t("live") : t("pairing")}
    </Button>
  );
}

function TabTrigger({
  value,
  icon,
  label,
  count,
}: Readonly<{
  value: string;
  icon: ReactNode;
  label: string;
  count?: number;
}>) {
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
}: Readonly<{
  busy: number | null;
  mirror: Mirror | null;
  preview: boolean;
  reachable: boolean;
  relative: (iso: string) => string;
  onHidePreview: () => void;
}>) {
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
  const when = relative(mirror.frame.drawnAt);
  let source: "bluetooth" | "mirror" | "last" = reachable ? "mirror" : "last";
  if (mirror.via === "bluetooth") source = "bluetooth";
  return (
    <span className={text} suppressHydrationWarning>
      {t(source, { when })}
    </span>
  );
}

