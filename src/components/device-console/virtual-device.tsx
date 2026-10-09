"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Check, MonitorSmartphone, Power, RefreshCw, Unlink, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { approveDeviceLink } from "@/app/link/actions";
import { DeviceWasm, WASM_URL, type Beep } from "@/lib/device/virtual/wasm";
import { VirtualDevice, type LogEntry, type Phase, type Snapshot } from "@/lib/device/virtual/runtime";
import {
  BadgeZone,
  DeviceShell,
  useDeviceShortcuts,
  type BadgeOption,
  type Side,
} from "@/components/device-console/device-shell";

interface Props {
  readonly officeId: string;
  readonly officeName: string;
  readonly badges: BadgeOption[];
}

const SOUND_KEY = "matecrew:virtual-device:sound";

/**
 * A terminal running in this tab: the firmware's own flow and screens in
 * WebAssembly, the same API as the real one. It shows up in the device list
 * and its console works like any other's.
 */
export function VirtualDevicePanel({ officeId, officeName, badges }: Props) {
  const t = useTranslations("devices.virtual");
  const [device, setDevice] = useState<VirtualDevice | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read once: the panel only renders after the wasm has loaded, never on the server.
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    let current: VirtualDevice | null = null;
    let cancelled = false;
    DeviceWasm.load()
      .then((wasm) => {
        if (cancelled) return;
        current = new VirtualDevice(wasm, `matecrew:virtual-device:${officeId}`);
        current.start();
        setDevice(current);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      current?.dispose();
    };
  }, [officeId]);

  useEffect(() => {
    device?.setBeep(sound ? playBeep : () => {});
  }, [device, sound]);

  useWasmHotReload(device);

  if (error) return <p className="text-destructive">{t("loadError", { error })}</p>;
  if (!device) return <p className="text-muted-foreground">{t("loading")}</p>;
  return (
    <Running
      device={device}
      officeId={officeId}
      officeName={officeName}
      badges={badges}
      sound={sound}
      onSound={(on) => {
        setSound(on);
        try {
          localStorage.setItem(SOUND_KEY, on ? "on" : "off");
        } catch {
          // Storage blocked: the choice lasts until reload.
        }
      }}
    />
  );
}

function Running({
  device,
  officeId,
  officeName,
  badges,
  sound,
  onSound,
}: {
  device: VirtualDevice;
  officeId: string;
  officeName: string;
  badges: BadgeOption[];
  sound: boolean;
  onSound: (on: boolean) => void;
}) {
  const t = useTranslations("devices.virtual");
  const tc = useTranslations("devices.console");
  const snapshot = useSyncExternalStore(device.subscribe, device.getSnapshot, device.getSnapshot);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [pressed, setPressed] = useState<Side | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const shortcuts = useMemo(
    () => ({
      key: (side: Side) => {
        setPressed(side);
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setPressed(null), 250);
        device.press(side);
      },
      badge: () => setBadgeOpen(true),
      sync: () => device.syncNow(),
    }),
    [device],
  );
  useDeviceShortcuts(shortcuts, badgeOpen);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/org/${officeId}/admin/devices`}>
            <ArrowLeft /> {tc("back")}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">{snapshot.linked?.deviceName ?? t("title")}</h1>
        <PhasePill phase={snapshot.phase} />
        <div className="ml-auto flex flex-wrap gap-2">
          {snapshot.linked && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/org/${officeId}/admin/devices/${snapshot.linked.deviceId}`} target="_blank">
                <MonitorSmartphone /> {tc("open")}
              </Link>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => device.syncNow()} disabled={!snapshot.linked}>
            <RefreshCw /> {tc("sync")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => device.setNetwork(!snapshot.network)}>
            {snapshot.network ? <WifiOff /> : <Wifi />} {snapshot.network ? t("cutWifi") : t("restoreWifi")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => device.restart()}>
            <Power /> {tc("restart")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (globalThis.confirm(t("forgetConfirm"))) device.forget();
            }}
          >
            <Unlink /> {t("forget")}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onSound(!sound)} aria-label={sound ? t("mute") : t("unmute")}>
            {sound ? <Volume2 /> : <VolumeX />}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <DeviceShell
            pressed={pressed}
            onKey={shortcuts.key}
            screen={<FrameCanvas bits={snapshot.bits} refreshes={snapshot.refreshes} />}
            badge={
              <BadgeZone
                badges={badges}
                open={badgeOpen}
                onOpenChange={setBadgeOpen}
                flashing={false}
                onBadge={(uid) => device.tap(uid)}
              />
            }
          />
          <p className="text-center text-xs text-muted-foreground">
            {t("hint", { id: snapshot.hardwareId })} {tc("shortcuts")}
          </p>
        </div>

        <div className="space-y-4">
          {snapshot.link && <LinkCard code={snapshot.link.code} url={snapshot.link.url} officeId={officeId} officeName={officeName} />}
          <SensorsCard device={device} />
          <QueueCard queue={snapshot.queue} />
        </div>
      </div>

      <Monitor logs={snapshot.logs} />
    </div>
  );
}

function PhasePill({ phase }: { phase: Phase }) {
  const t = useTranslations("devices.virtual.phase");
  const live = phase === "online";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        live ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
        phase === "linking" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      <span className={cn("size-2 rounded-full", live ? "bg-emerald-500" : phase === "linking" ? "animate-pulse bg-amber-500" : "bg-zinc-400")} />
      {t(phase)}
    </span>
  );
}

const PAPER = [236, 234, 227];
const INK = [29, 29, 31];

/** Draws the 1-bit frame; each new one flashes the way an e-ink panel refreshes. */
function FrameCanvas({ bits, refreshes }: { bits: Uint8Array | null; refreshes: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context || !bits) return;
    const image = context.createImageData(800, 480);
    for (let i = 0; i < 800 * 480; i++) {
      const [r, g, b] = bits[i >> 3] & (0x80 >> (i & 7)) ? INK : PAPER;
      image.data.set([r, g, b, 255], i * 4);
    }
    context.putImageData(image, 0, 0);
    if (refreshes > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.animate([{ filter: "invert(1)" }, { filter: "none" }, { filter: "invert(1)" }, { filter: "none" }], {
        duration: 600,
        easing: "steps(1, end)",
      });
    }
  }, [bits, refreshes]);
  return (
    <canvas
      ref={canvas}
      width={800}
      height={480}
      className="size-full [@media(min-resolution:2dppx)]:[image-rendering:pixelated]"
    />
  );
}

function LinkCard({ code, url, officeId, officeName }: { code: string; url: string; officeId: string; officeName: string }) {
  const t = useTranslations("devices.virtual");
  const [pending, setPending] = useState(false);
  return (
    <Card className="gap-3 border-amber-500/40 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{t("linkTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <div className="font-mono text-2xl font-semibold tracking-widest">{code}</div>
        <Button
          className="w-full"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const form = new FormData();
            form.set("code", code);
            form.set("officeId", officeId);
            form.set("name", t("defaultName"));
            const result = await approveDeviceLink(form);
            setPending(false);
            if (result.success) toast.success(t("approved", { office: result.officeName }));
            else toast.error(result.error);
          }}
        >
          <Check /> {t("approve", { office: officeName })}
        </Button>
        <Button asChild variant="link" size="sm" className="h-auto w-full p-0">
          <a href={url} target="_blank" rel="noreferrer">
            {t("approveElsewhere")}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function SensorsCard({ device }: { device: VirtualDevice }) {
  const t = useTranslations("devices.virtual");
  const [sensors, setSensors] = useState(() => device.getSensors());
  const change = (patch: Partial<typeof sensors>) => {
    const next = { ...sensors, ...patch };
    setSensors(next);
    device.setSensors(next);
  };
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{t("sensors")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        <Slider
          label={t("battery")}
          value={sensors.batteryMv}
          min={3200}
          max={4200}
          step={10}
          format={(mv) => `${(mv / 1000).toFixed(2)} V`}
          onChange={(batteryMv) => change({ batteryMv })}
        />
        <Slider
          label={t("signal")}
          value={sensors.wifiRssi}
          min={-90}
          max={-40}
          step={1}
          format={(dbm) => `${dbm} dBm`}
          onChange={(wifiRssi) => change({ wifiRssi })}
        />
        <p className="text-xs text-muted-foreground">{t("sensorsHint")}</p>
      </CardContent>
    </Card>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{format(value)}</span>
      </span>
      <input
        type="range"
        className="w-full accent-primary"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function QueueCard({ queue }: { queue: Snapshot["queue"] }) {
  const t = useTranslations("devices.virtual");
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{t("queue", { count: queue.length })}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("queueEmpty")}</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {queue.map((take) => (
              <li key={take.id} className="flex justify-between gap-2">
                <span>{take.action}</span>
                <span className="truncate text-muted-foreground">{take.badgeUid}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const LOG_COLORS: Record<LogEntry["kind"], string> = {
  info: "text-zinc-300",
  http: "text-sky-300",
  flow: "text-emerald-300",
  error: "text-red-300",
};

/** What the serial monitor shows for the real one. */
function Monitor({ logs }: { logs: LogEntry[] }) {
  const t = useTranslations("devices.virtual");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [logs]);
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-400">{t("monitor")}</div>
      <div className="h-56 overflow-y-auto px-4 py-2 font-mono text-[12px] leading-5">
        {logs.map((entry) => (
          <div key={entry.id} className="flex gap-3">
            <span className="shrink-0 text-zinc-600">{new Date(entry.at).toLocaleTimeString()}</span>
            <span className={cn("break-all", LOG_COLORS[entry.kind])}>{entry.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}

let audio: AudioContext | null = null;

/** The piezo's patterns: a click for a key, two rising notes for a take, a low buzz for an error. */
function playBeep(beep: Beep) {
  audio ??= new AudioContext();
  const tones: Record<Beep, [hz: number, seconds: number][]> = {
    key: [[4000, 0.03]],
    accepted: [
      [3000, 0.06],
      [4000, 0.09],
    ],
    error: [[440, 0.25]],
  };
  let at = audio.currentTime;
  for (const [hz, seconds] of tones[beep]) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = hz;
    gain.gain.value = 0.04;
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + seconds);
    at += seconds + 0.05;
  }
}

/**
 * In `bun dev`, picks up a wasm that `just web` rebuilt and swaps it in
 * without losing the device's state: edit a screen in device/ui, save, look.
 */
function useWasmHotReload(device: VirtualDevice | null) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !device) return;
    let version: string | null = null;
    const timer = setInterval(async () => {
      const response = await fetch(WASM_URL, { method: "HEAD", cache: "no-store" }).catch(() => null);
      const next = response?.headers.get("etag") ?? response?.headers.get("last-modified") ?? null;
      if (version !== null && next !== null && next !== version) device.replaceWasm(await DeviceWasm.load());
      version = next;
    }, 1500);
    return () => clearInterval(timer);
  }, [device]);
}
