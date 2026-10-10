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
export function StatusStrip({ live, now, timeZone }: { live: LiveStatus; now: Date; timeZone: string }) {
  const t = useTranslations("devices.console");
  const format = useFormatter();
  const relative = (iso: string) => format.relativeTime(new Date(iso), now);

  const charge = battery(live.batteryMv);
  const BatteryIcon = !charge
    ? Battery
    : charge.low
      ? BatteryWarning
      : charge.percent > 66
        ? BatteryFull
        : charge.percent > 33
          ? BatteryMedium
          : BatteryLow;
  const band = live.wifiRssi === null ? null : signalBand(live.wifiRssi);
  const SignalIcon = band ? SIGNAL_ICON[band] : WifiOff;

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 xl:grid-cols-6">
      <Cell
        icon={<Radio />}
        label={t("strip.link")}
        value={
          <span className="inline-flex items-center gap-2">
            <span className="relative flex size-2">
              {live.reachable && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/70" />}
              <span className={cn("relative size-2 rounded-full", live.reachable ? "bg-emerald-500" : "bg-zinc-400")} />
            </span>
            {live.reachable ? t("live") : t("offline")}
          </span>
        }
        detail={live.reachable ? t("strip.linkLive") : t("strip.linkQueued")}
      />
      <Cell
        icon={<Clock />}
        label={t("strip.lastSeen")}
        value={live.lastSeenAt ? relative(live.lastSeenAt) : t("neverSeen")}
        detail={
          live.lastSeenAt
            ? format.dateTime(new Date(live.lastSeenAt), { dateStyle: "short", timeStyle: "medium", timeZone })
            : null
        }
        muted={!live.lastSeenAt}
      />
      <Cell
        icon={<Cpu />}
        label={t("firmware")}
        value={live.firmwareVersion ?? "—"}
        detail={live.firmwareVersion ? t("strip.firmwareReported") : t("strip.notReported")}
        mono
        muted={!live.firmwareVersion}
      />
      <Cell
        icon={<BatteryIcon />}
        label={t("battery")}
        value={charge ? `${charge.percent} %` : "—"}
        detail={
          charge
            ? `${format.number(charge.millivolts / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} V${charge.low ? ` · ${t("strip.batteryLow")}` : ""}`
            : live.batteryMv === null
              ? t("strip.notReported")
              : t("strip.batteryImplausible")
        }
        alert={charge?.low}
        muted={!charge}
      />
      <Cell
        icon={<SignalIcon />}
        label={t("signal")}
        value={live.wifiRssi === null ? "—" : `${live.wifiRssi} dBm`}
        detail={band ? t(`strip.signal.${band}`) : t("strip.notReported")}
        muted={live.wifiRssi === null}
      />
      <Cell
        icon={<MonitorSmartphone />}
        label={t("strip.screen")}
        value={live.frame ? relative(live.frame.drawnAt) : t("strip.screenNone")}
        detail={live.frame ? (live.reachable ? t("strip.screenLive") : t("strip.screenLast")) : t("strip.screenHint")}
        muted={!live.frame}
      />
    </dl>
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
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  mono?: boolean;
  muted?: boolean;
  alert?: boolean;
}) {
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
