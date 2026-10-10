"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode, type SubmitEvent } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Activity,
  ArrowRight,
  Bluetooth,
  BluetoothConnected,
  BluetoothOff,
  Check,
  CircleAlert,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Hash,
  Keyboard,
  Link2,
  LoaderCircle,
  MemoryStick,
  MonitorOff,
  RefreshCw,
  Timer,
  Wifi,
  WifiPen,
} from "lucide-react";
import { BleDevice, commands, isSupported, type DeviceInfo, type LinkError } from "@matecrew/device-ui/link";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TooltipProvider } from "@/components/ui/tooltip";
import { bluetoothLinkStatus, officeTerminal, prepareBluetoothLink } from "@/app/org/[officeId]/admin/devices/bluetooth/actions";
import { useBleScreen, useBleSession } from "@/components/device-console/ble-link";
import { BadgeZone, DeviceShell, useDeviceShortcuts, type BadgeOption, type Side } from "@/components/device-console/device-shell";
import type { ConsoleKind, LogEntry } from "@/components/device-console/device-log";
import { FrameCanvas } from "@/components/device-console/frame-canvas";
import { LogPanel } from "@/components/device-console/log-panel";
import { MemoryCard } from "@/components/device-console/memory-panel";
import { ScreenControl } from "@/components/device-console/screen-control";
import { ActionsCard } from "@/components/device-console/terminal-actions";
import { FactList, RailCard, Workbench, type Fact } from "@/components/device-console/workbench";
import { signalBand } from "@/components/device-console/readings";

/** How often the page asks the site whether the terminal linked, and for how long. */
const LINK_POLL_MS = 3000;
const LINK_WAIT_MS = 10 * 60 * 1000;
/** How long a key or the reader stays lit after a press. */
const FLASH_MS = 700;
const OTHER = "__other__";

type SetupState =
  | { step: "form" }
  | { step: "sending"; network: string }
  | { step: "waiting"; network: string; hardwareId: string; since: string }
  | { step: "linked"; network: string; deviceId: string }
  | { step: "timeout"; network: string };

/**
 * A terminal nearby over Web Bluetooth: find it, set it up (Wi-Fi and a pre-approved link in one
 * write) when it is new, and drive and debug it like the console: its screen, keys and reader,
 * its status, memory and log.
 */
export function BluetoothPanel({ officeId, badges }: Readonly<{ officeId: string; badges: BadgeOption[] }>) {
  return (
    <TooltipProvider>
      <Panel officeId={officeId} badges={badges} />
    </TooltipProvider>
  );
}

function Panel({ officeId, badges }: Readonly<{ officeId: string; badges: BadgeOption[] }>) {
  const t = useTranslations("deviceBluetooth");
  const [supported, setSupported] = useState<boolean | null>(null);
  const [device, setDevice] = useState<BleDevice | null>(null);
  const [connecting, startConnecting] = useTransition();
  const [setup, setSetup] = useState<SetupState>({ step: "form" });
  const session = useBleSession(device);
  const { info } = session;

  useEffect(() => {
    void isSupported().then(setSupported);
  }, []);

  const report = useCallback(
    (error: LinkError) => {
      if (error.code !== "cancelled") toast.error(t(`errors.${error.code}`, { message: error.message }));
    },
    [t],
  );

  const connect = () =>
    startConnecting(async () => {
      const picked = await BleDevice.request();
      if (!picked.ok) return report(picked.error);
      picked.value.onDisconnect(() => {
        toast.info(t("disconnected"));
        setDevice(null);
      });
      setSetup((current) => (current.step === "linked" || current.step === "timeout" ? { step: "form" } : current));
      setDevice(picked.value);
    });

  // Once the settings are sent, the site says when the terminal redeemed its link; the terminal
  // may drop Bluetooth meanwhile (it joins the Wi-Fi), which does not stop the wait.
  useEffect(() => {
    if (setup.step !== "waiting") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.parse(setup.since) + LINK_WAIT_MS;
    const poll = async () => {
      if (stopped) return;
      if (Date.now() > deadline) return setSetup({ step: "timeout", network: setup.network });
      const linked = await bluetoothLinkStatus({ officeId, hardwareId: setup.hardwareId, since: setup.since });
      if (stopped) return;
      if (linked) return setSetup({ step: "linked", network: setup.network, deviceId: linked.deviceId });
      timer = setTimeout(() => void poll(), LINK_POLL_MS);
    };
    timer = setTimeout(() => void poll(), LINK_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [setup, officeId]);

  const provision = async (values: { ssid: string; password: string; name: string }) => {
    if (!device || !info) return;
    setSetup({ step: "sending", network: values.ssid });
    const since = new Date().toISOString();
    const prepared = await prepareBluetoothLink({ officeId, hardwareId: info.hardwareId, name: values.name });
    if (!prepared.ok) {
      toast.error(t(prepared.error === "forbidden" ? "errors.forbidden" : "errors.invalid", { message: "" }));
      return setSetup({ step: "form" });
    }
    const sent = await device.provision({ ssid: values.ssid, password: values.password, site: window.location.origin, secret: prepared.secret });
    if (!sent.ok) {
      report(sent.error);
      return setSetup({ step: "form" });
    }
    setSetup({ step: "waiting", network: values.ssid, hardwareId: info.hardwareId, since });
  };

  if (supported === false) {
    return (
      <Alert>
        <BluetoothOff />
        <AlertDescription>{t("unsupported")}</AlertDescription>
      </Alert>
    );
  }

  const settingUp = setup.step !== "form";
  if (!device && !settingUp) return <ConnectCard connecting={connecting} ready={supported === true} onConnect={connect} />;

  return (
    <div className="space-y-6">
      <TerminalBar
        device={device}
        info={info}
        connecting={connecting}
        onConnect={connect}
        onRefresh={session.refresh}
      />
      {session.infoError && !info && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{t(`errors.${session.infoError.code}`, { message: session.infoError.message })}</AlertDescription>
        </Alert>
      )}
      {(settingUp || info?.setupOpen) && (
        <SetupCard
          officeId={officeId}
          info={info}
          state={setup}
          onSubmit={(values) => void provision(values)}
          onRetry={() => setSetup({ step: "form" })}
        />
      )}
      {info && !info.setupOpen && !settingUp && <LinkedNotice officeId={officeId} info={info} />}
      {device && <Debugger device={device} badges={badges} session={session} onError={report} />}
    </div>
  );
}

/** Before any terminal: what to do, in three steps, and the button that opens the browser's chooser. */
function ConnectCard({ connecting, ready, onConnect }: Readonly<{ connecting: boolean; ready: boolean; onConnect: () => void }>) {
  const t = useTranslations("deviceBluetooth.connectCard");
  const steps = [t("step1"), t("step2"), t("step3")];
  return (
    <section className="max-w-4xl overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_14rem] md:items-center">
        <div className="space-y-6">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">{t("title")}</h2>
            <p className="max-w-prose text-muted-foreground">{t("description")}</p>
          </div>
          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular-nums">
                  {index + 1}
                </span>
                <span className="pt-0.5 text-sm">{step}</span>
              </li>
            ))}
          </ol>
          <Button size="lg" onClick={onConnect} disabled={connecting || !ready}>
            {connecting ? <LoaderCircle className="animate-spin" /> : <Bluetooth />}
            {connecting ? t("connecting") : t("connect")}
          </Button>
        </div>
        <div className="hidden justify-center md:flex" aria-hidden>
          <div className="relative grid size-40 place-items-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-sky-500/10 [animation-duration:2.5s]" />
            <span className="absolute inset-6 rounded-full bg-sky-500/10" />
            <span className="relative grid size-16 place-items-center rounded-full bg-sky-600 text-white shadow-lg">
              <Bluetooth className="size-7" />
            </span>
          </div>
        </div>
      </div>
      <p className="border-t bg-muted/40 px-6 py-3 text-xs text-muted-foreground sm:px-8">{t("note")}</p>
    </section>
  );
}

/** Which terminal this is and how it stands; reconnect when the link dropped during a setup. */
function TerminalBar({
  device,
  info,
  connecting,
  onConnect,
  onRefresh,
}: Readonly<{
  device: BleDevice | null;
  info: DeviceInfo | null;
  connecting: boolean;
  onConnect: () => void;
  onRefresh: () => void;
}>) {
  const t = useTranslations("deviceBluetooth");
  let subtitle: ReactNode = t("bar.disconnected");
  if (device) subtitle = info ? <span className="font-mono">{info.hardwareId}</span> : t("bar.reading");
  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full",
          device ? "bg-sky-600/10 text-sky-600 dark:text-sky-400" : "bg-muted text-muted-foreground",
        )}
      >
        {device ? <BluetoothConnected className="size-5" /> : <BluetoothOff className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold">{info?.name ?? device?.name ?? t("bar.gone")}</span>
          {info && (
            <Badge variant={info.setupOpen ? "secondary" : "outline"}>
              {info.setupOpen ? t("bar.setupMode") : t("bar.linked")}
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <div className="flex items-center gap-2">
        {device ? (
          <>
            <Button variant="ghost" size="icon-sm" aria-label={t("bar.refresh")} title={t("bar.refresh")} onClick={onRefresh}>
              <RefreshCw />
            </Button>
            <Button variant="outline" size="sm" onClick={() => device.disconnect()}>
              {t("disconnect")}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={onConnect} disabled={connecting}>
            {connecting ? <LoaderCircle className="animate-spin" /> : <Bluetooth />} {t("bar.reconnect")}
          </Button>
        )}
      </div>
    </section>
  );
}

/** Wi-Fi, this site's address and a pre-approved link in one write; then the way to the link. */
function SetupCard({
  officeId,
  info,
  state,
  onSubmit,
  onRetry,
}: Readonly<{
  officeId: string;
  info: DeviceInfo | null;
  state: SetupState;
  onSubmit: (values: { ssid: string; password: string; name: string }) => void;
  onRetry: () => void;
}>) {
  const t = useTranslations("deviceBluetooth.setup");
  return (
    <section className="grid overflow-hidden rounded-xl border bg-card shadow-sm lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <WifiPen className="size-5 text-muted-foreground" /> {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {(state.step === "form" || state.step === "sending") && info && (
          <SetupForm networks={info.networks} sending={state.step === "sending"} onSubmit={onSubmit} />
        )}
        {state.step === "linked" && (
          <div className="space-y-3">
            <p className="text-sm">{t("linked")}</p>
            <Button asChild>
              <Link href={`/org/${officeId}/admin/devices/${state.deviceId}`}>
                {t("openDevice")} <ArrowRight />
              </Link>
            </Button>
          </div>
        )}
        {state.step === "waiting" && <p className="text-sm text-muted-foreground">{t("waitingHint")}</p>}
        {state.step === "timeout" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("timeout")}</p>
            <Button variant="outline" onClick={onRetry}>
              {t("retry")}
            </Button>
          </div>
        )}
      </div>
      <SetupProgress state={state} />
    </section>
  );
}

function SetupForm({
  networks,
  sending,
  onSubmit,
}: Readonly<{
  networks: string[];
  sending: boolean;
  onSubmit: (values: { ssid: string; password: string; name: string }) => void;
}>) {
  const t = useTranslations("deviceBluetooth.setup");
  const [network, setNetwork] = useState(networks[0] ?? OTHER);
  const [reveal, setReveal] = useState(false);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    onSubmit({
      ssid: network === OTHER ? text("ssid").trim() : network,
      password: text("password"),
      name: text("name").trim() || t("defaultName"),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{t("network")}</legend>
        <div role="radiogroup" aria-label={t("network")} className="grid gap-1.5 sm:grid-cols-2">
          {[...networks, OTHER].map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={network === name}
              onClick={() => setNetwork(name)}
              className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                network === name && "border-foreground/40 bg-accent",
              )}
            >
              <Wifi className="size-4 shrink-0 text-muted-foreground" />
              <span className={cn("truncate", name === OTHER && "text-muted-foreground")}>
                {name === OTHER ? t("otherNetwork") : name}
              </span>
              {network === name && <Check className="ml-auto size-4 shrink-0" />}
            </button>
          ))}
        </div>
        {networks.length === 0 && <p className="text-xs text-muted-foreground">{t("noNetworks")}</p>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        {network === OTHER && (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="ble-ssid">{t("ssid")}</Label>
            <Input id="ble-ssid" name="ssid" required maxLength={32} autoComplete="off" />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="ble-password">{t("password")}</Label>
          <div className="relative">
            <Input
              id="ble-password"
              name="password"
              type={reveal ? "text" : "password"}
              maxLength={64}
              autoComplete="off"
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setReveal((current) => !current)}
              aria-label={reveal ? t("hidePassword") : t("showPassword")}
              className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground"
            >
              {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ble-name">{t("name")}</Label>
          <Input id="ble-name" name="name" maxLength={60} placeholder={t("defaultName")} />
        </div>
      </div>
      <Button type="submit" disabled={sending}>
        {sending ? <LoaderCircle className="animate-spin" /> : <Link2 />}
        {sending ? t("sending") : t("submit")}
      </Button>
    </form>
  );
}

type StepState = "todo" | "active" | "done" | "failed";

/** Settings sent, Wi-Fi joined, linked: where the setup stands. */
function SetupProgress({ state }: Readonly<{ state: SetupState }>) {
  const t = useTranslations("deviceBluetooth.setup.progress");
  const network = state.step === "form" ? null : state.network;
  const steps: { label: string; detail: string; state: StepState }[] = [
    {
      label: t("send"),
      detail: t("sendDetail"),
      state: { form: "todo", sending: "active", waiting: "done", linked: "done", timeout: "done" }[state.step] as StepState,
    },
    {
      label: network ? t("joinNamed", { network }) : t("join"),
      detail: t("joinDetail"),
      state: { form: "todo", sending: "todo", waiting: "active", linked: "done", timeout: "failed" }[state.step] as StepState,
    },
    {
      label: t("link"),
      detail: t("linkDetail"),
      state: { form: "todo", sending: "todo", waiting: "active", linked: "done", timeout: "failed" }[state.step] as StepState,
    },
  ];
  return (
    <ol className="space-y-0 border-t bg-muted/30 p-6 lg:border-t-0 lg:border-l">
      {steps.map((step, index) => (
        <li key={step.label} className="relative flex gap-3 pb-6 last:pb-0">
          {index < steps.length - 1 && <span className="absolute top-7 bottom-1 left-[0.6875rem] w-px bg-border" />}
          <StepIcon state={step.state} />
          <div className="min-w-0 pt-0.5">
            <div className={cn("text-sm font-medium", step.state === "todo" && "text-muted-foreground")}>{step.label}</div>
            <div className="text-xs text-muted-foreground">{step.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ state }: Readonly<{ state: StepState }>) {
  const base = "relative grid size-6 shrink-0 place-items-center rounded-full border bg-card";
  if (state === "done")
    return (
      <span className={cn(base, "border-foreground bg-foreground text-background")}>
        <Check className="size-3.5" />
      </span>
    );
  if (state === "active")
    return (
      <span className={base}>
        <LoaderCircle className="size-3.5 animate-spin" />
      </span>
    );
  if (state === "failed")
    return (
      <span className={cn(base, "border-destructive text-destructive")}>
        <CircleAlert className="size-3.5" />
      </span>
    );
  return <span className={base} />;
}

/** A terminal that already has a site: its console here when it is this office's. */
function LinkedNotice({ officeId, info }: Readonly<{ officeId: string; info: DeviceInfo }>) {
  const t = useTranslations("deviceBluetooth.linked");
  const [known, setKnown] = useState<{ hardwareId: string; terminal: { id: string; name: string } | null } | null>(null);
  useEffect(() => {
    let current = true;
    // Not found and not reachable read the same: no console to offer.
    officeTerminal({ officeId, hardwareId: info.hardwareId })
      .catch(() => null)
      .then((terminal) => {
        if (current) setKnown({ hardwareId: info.hardwareId, terminal });
      });
    return () => {
      current = false;
    };
  }, [officeId, info.hardwareId]);
  if (known?.hardwareId !== info.hardwareId) return null;
  return (
    <Alert>
      <Link2 />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{known.terminal ? t("ours", { name: known.terminal.name }) : t("elsewhere", { site: info.site ?? "?" })}</span>
        {known.terminal && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/org/${officeId}/admin/devices/${known.terminal.id}`}>
              {t("openConsole")} <ArrowRight />
            </Link>
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** The terminal in range as the console shows one: its screen, keys and reader; status, memory, actions; log. */
function Debugger({
  device,
  badges,
  session,
  onError,
}: Readonly<{
  device: BleDevice;
  badges: BadgeOption[];
  session: ReturnType<typeof useBleSession>;
  onError: (error: LinkError) => void;
}>) {
  const t = useTranslations("deviceBluetooth");
  const tConsole = useTranslations("devices.console");
  const format = useFormatter();
  const { frame, error } = useBleScreen(device);
  const [pressed, setPressed] = useState<Side | "badge" | null>(null);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [clearedAt, setClearedAt] = useState(0);
  const eventId = useRef(0);
  const flash = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { info } = session;

  const addEvent = useCallback((kind: ConsoleKind, text: string) => {
    const entry: LogEntry = { id: `c${++eventId.current}`, at: Date.now(), source: "console", level: kind === "error" ? "E" : "I", tag: kind, text };
    setEvents((current) => [...current, entry].slice(-200));
  }, []);

  /** Sends a command and logs it, or the reason it did not go. */
  const run = useCallback(
    (what: string, kind: ConsoleKind, action: () => Promise<{ ok: true } | { ok: false; error: LinkError }>) => {
      void action().then((done) => {
        if (done.ok) return addEvent(kind, what);
        onError(done.error);
        addEvent("error", `${what}: ${done.error.message}`);
      });
    },
    [addEvent, onError],
  );

  const press = useCallback(
    (side: Side) => {
      setPressed(side);
      clearTimeout(flash.current);
      flash.current = setTimeout(() => setPressed(null), FLASH_MS);
      run(side === "left" ? tConsole("kind.keyLeft") : tConsole("kind.keyRight"), "input", () => commands.press(device, side));
    },
    [device, run, tConsole],
  );
  const badge = (uid: string) => {
    setPressed("badge");
    clearTimeout(flash.current);
    flash.current = setTimeout(() => setPressed(null), FLASH_MS);
    run(tConsole("kind.badge", { uid }), "input", () => commands.badge(device, uid));
  };
  const sync = useCallback(() => run(tConsole("kind.sync"), "system", () => commands.sync(device)), [device, run, tConsole]);

  const shortcuts = useMemo(() => ({ key: press, badge: () => setBadgeOpen(true), sync }), [press, sync]);
  useDeviceShortcuts(shortcuts, badgeOpen);

  const lines = useMemo(
    () => [...events, ...session.logs].filter((line) => line.at > clearedAt).sort((a, b) => a.at - b.at),
    [events, session.logs, clearedAt],
  );

  let message: string | null = null;
  if (error?.code === "unsupported") message = t("screen.unsupported");
  else if (error && error.code !== "disconnected") message = t("screen.failed", { message: error.message });

  const update = async (image: Uint8Array, progress: (percent: number) => void) => {
    addEvent("system", tConsole("log.firmwareSending"));
    const done = await device.updateFirmware(image, { onProgress: (sent, total) => progress(Math.round((sent * 100) / total)) });
    if (done.ok) {
      toast.success(tConsole("log.firmwareSent"));
      addEvent("system", tConsole("log.firmwareSent"));
    } else {
      onError(done.error);
      addEvent("error", done.error.message);
    }
  };

  return (
    <Workbench
      terminal={
        <div className="space-y-3">
          <DeviceShell
            pressed={pressed === "left" || pressed === "right" ? pressed : null}
            onKey={press}
            indicator={
              frame && (
                <span className="text-[10px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                  {t("screen.live")}
                </span>
              )
            }
            screen={
              frame ? (
                <ScreenControl
                  label={t("screen.tap")}
                  onTap={(x, y) => run(tConsole("kind.tap", { x: x * 4, y: y * 4 }), "input", () => commands.tap(device, x, y))}
                >
                  <FrameCanvas bits={frame.bits} />
                </ScreenControl>
              ) : (
                <p className="flex size-full items-center justify-center gap-2 p-4 text-center text-sm text-zinc-600">
                  {message ? <MonitorOff className="size-4 shrink-0" /> : <LoaderCircle className="size-4 shrink-0 animate-spin" />}
                  {message ?? t("screen.waiting")}
                </p>
              )
            }
            badge={
              <BadgeZone badges={badges} open={badgeOpen} onOpenChange={setBadgeOpen} flashing={pressed === "badge"} onBadge={badge} />
            }
          />
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Keyboard className="hidden size-3.5 shrink-0 sm:block" /> {tConsole("shortcuts")} {tConsole("tapHint")}
          </p>
        </div>
      }
      rail={
        <>
          <RailCard icon={<Activity />} title={tConsole("status.title")}>
            {info ? (
              <FactList facts={bleFacts(info, t, tConsole, format)} />
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" /> {t("bar.reading")}
              </p>
            )}
          </RailCard>
          <MemoryCard samples={session.memory} state="live" />
          <ActionsCard
            deviceName={info?.name ?? device.name}
            description={t("actionsHint")}
            onSync={sync}
            onBoth={() => run(tConsole("kind.both"), "input", () => commands.both(device))}
            onRestart={() => run(tConsole("kind.restart"), "system", () => commands.restart(device))}
            onFirmware={update}
          />
        </>
      }
      logs={
        <LogPanel
          entries={lines}
          fileName={info?.name ?? device.name}
          onClear={() => {
            setClearedAt(Date.now());
            session.clearLogs();
          }}
        />
      }
    />
  );
}

/** What the terminal says about itself, as rows. */
function bleFacts(
  info: DeviceInfo,
  t: ReturnType<typeof useTranslations<"deviceBluetooth">>,
  tConsole: ReturnType<typeof useTranslations<"devices.console">>,
  format: ReturnType<typeof useFormatter>,
): Fact[] {
  const minutes = Math.floor(info.uptime / 60);
  const rssi = info.wifi?.rssi ?? null;
  const signal: ReactNode = rssi == null ? null : [tConsole(`strip.signal.${signalBand(rssi)}`), `${rssi} dBm`].join(" · ");
  return [
    {
      icon: <Cpu />,
      label: tConsole("firmware"),
      value: info.firmware.version,
      detail: [info.firmware.slot, info.firmware.build].filter(Boolean).join(" · "),
      mono: true,
    },
    {
      icon: <Wifi />,
      label: tConsole("signal"),
      value: info.wifi?.ssid ?? t("info.noWifi"),
      detail: signal,
      muted: !info.wifi,
    },
    { icon: <Globe />, label: t("info.site"), value: info.site ?? "—", muted: !info.site },
    {
      icon: <Link2 />,
      label: t("info.link"),
      value: info.linked ? t("info.linked") : t("info.notLinked"),
      muted: !info.linked,
    },
    {
      icon: <Timer />,
      label: tConsole("status.uptime"),
      value: tConsole("status.uptimeValue", { hours: Math.floor(minutes / 60), minutes: minutes % 60 }),
    },
    {
      icon: <MemoryStick />,
      label: t("info.heap"),
      value: tConsole("memory.kb", { value: format.number(info.heap / 1024, { maximumFractionDigits: 1 }) }),
    },
    { icon: <Hash />, label: tConsole("hardwareId"), value: info.hardwareId, mono: true },
  ];
}
