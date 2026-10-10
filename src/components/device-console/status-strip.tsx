"use client";

import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  Battery,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Clock,
  Cpu,
  MonitorSmartphone,
  Radio,
  Wifi,
  WifiHigh,
  WifiLow,
  WifiOff,
  WifiZero,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveStatus } from "@/lib/device/live";
import { battery, signalBand } from "./readings";

const SIGNAL_ICON = { excellent: Wifi, good: WifiHigh, fair: WifiLow, weak: WifiZero } as const;

/** The terminal at a glance, from the console's live poll: link, contact, firmware, sensors, screen. */
export function StatusStrip({ live, now, timeZone }: Readonly<{ live: LiveStatus; now: Date; timeZone: string }>) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 xl:grid-cols-6">
      <LinkCell reachable={live.reachable} />
      <LastSeenCell lastSeenAt={live.lastSeenAt} now={now} timeZone={timeZone} />
      <FirmwareCell version={live.firmwareVersion} />
      <BatteryCell millivolts={live.batteryMv} />
      <SignalCell rssi={live.wifiRssi} />
      <ScreenCell frame={live.frame} reachable={live.reachable} now={now} />
    </dl>
  );
}

function LinkCell({ reachable }: Readonly<{ reachable: boolean }>) {
  const t = useTranslations("devices.console");
  return (
    <Cell
      icon={<Radio />}
      label={t("strip.link")}
      value={
        <span className="inline-flex items-center gap-2">
          <span className="relative flex size-2">
            {reachable && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/70" />}
            <span className={cn("relative size-2 rounded-full", reachable ? "bg-emerald-500" : "bg-zinc-400")} />
          </span>
          {reachable ? t("live") : t("offline")}
        </span>
      }
      detail={reachable ? t("strip.linkLive") : t("strip.linkQueued")}
    />
  );
}

function LastSeenCell({ lastSeenAt, now, timeZone }: Readonly<{ lastSeenAt: string | null; now: Date; timeZone: string }>) {
  const t = useTranslations("devices.console");
  const format = useFormatter();
  return (
    <Cell
      icon={<Clock />}
      label={t("strip.lastSeen")}
      value={lastSeenAt ? format.relativeTime(new Date(lastSeenAt), now) : t("neverSeen")}
      detail={lastSeenAt ? format.dateTime(new Date(lastSeenAt), { dateStyle: "short", timeStyle: "medium", timeZone }) : null}
      muted={!lastSeenAt}
    />
  );
}

function FirmwareCell({ version }: Readonly<{ version: string | null }>) {
  const t = useTranslations("devices.console");
  return (
    <Cell
      icon={<Cpu />}
      label={t("firmware")}
      value={version ?? "—"}
      detail={version ? t("strip.firmwareReported") : t("strip.notReported")}
      mono
      muted={!version}
    />
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

function BatteryCell({ millivolts }: Readonly<{ millivolts: number | null }>) {
  const t = useTranslations("devices.console");
  const format = useFormatter();
  const charge = battery(millivolts);
  let detail: string;
  if (charge) {
    const volts = format.number(charge.millivolts / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const warning = charge.low ? ` · ${t("strip.batteryLow")}` : "";
    detail = `${volts} V${warning}`;
  } else if (millivolts === null) {
    detail = t("strip.notReported");
  } else {
    detail = t("strip.batteryImplausible");
  }
  return (
    <Cell
      icon={<BatteryGlyph charge={charge} />}
      label={t("battery")}
      value={charge ? `${charge.percent} %` : "—"}
      detail={detail}
      alert={charge?.low}
      muted={!charge}
    />
  );
}

function SignalCell({ rssi }: Readonly<{ rssi: number | null }>) {
  const t = useTranslations("devices.console");
  const band = rssi === null ? null : signalBand(rssi);
  const SignalIcon = band ? SIGNAL_ICON[band] : WifiOff;
  return (
    <Cell
      icon={<SignalIcon />}
      label={t("signal")}
      value={rssi === null ? "—" : `${rssi} dBm`}
      detail={band ? t(`strip.signal.${band}`) : t("strip.notReported")}
      muted={rssi === null}
    />
  );
}

function ScreenCell({ frame, reachable, now }: Readonly<{ frame: LiveStatus["frame"]; reachable: boolean; now: Date }>) {
  const t = useTranslations("devices.console");
  const format = useFormatter();
  let detail = t("strip.screenHint");
  if (frame) detail = reachable ? t("strip.screenLive") : t("strip.screenLast");
  return (
    <Cell
      icon={<MonitorSmartphone />}
      label={t("strip.screen")}
      value={frame ? format.relativeTime(new Date(frame.drawnAt), now) : t("strip.screenNone")}
      detail={detail}
      muted={!frame}
    />
  );
}

function Cell({
  icon,
  label,
  value,
  detail,
  mono,
  muted,
  alert,
}: Readonly<{
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  mono?: boolean;
  muted?: boolean;
  alert?: boolean;
}>) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 truncate text-sm font-semibold tabular-nums",
          mono && "font-mono",
          muted && "font-normal text-muted-foreground",
          alert && "text-destructive",
        )}
        suppressHydrationWarning
      >
        {value}
      </dd>
      <dd className="text-xs text-pretty text-muted-foreground" suppressHydrationWarning>
        {detail}
      </dd>
    </div>
  );
}
