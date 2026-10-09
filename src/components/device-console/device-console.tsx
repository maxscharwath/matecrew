"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Check, Clock, Power, RefreshCw, WifiOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sendDeviceCommand } from "@/app/org/[officeId]/admin/devices/actions";
import type { ConsoleCommand } from "@/lib/device/commands";
import type { LiveStatus } from "@/lib/device/live";
import {
  BadgeZone,
  DeviceShell,
  useDeviceShortcuts,
  type BadgeOption,
  type Side,
} from "@/components/device-console/device-shell";

interface Props {
  readonly officeId: string;
  readonly device: { id: string; name: string; hardwareId: string };
  readonly badges: BadgeOption[];
  readonly initial: LiveStatus;
  /** When the server rendered the page: relative times start from it, so hydration matches. */
  readonly renderedAt: string;
}

/** How long a key or the badge zone stays lit after a press. */
const FLASH_MS = 700;

/**
 * Remote control of a terminal: its panel mirrored live, its keys and badge
 * reader driven from here, and the commands it has picked up.
 */
export function DeviceConsole({ officeId, device, badges, initial, renderedAt }: Props) {
  const t = useTranslations("devices.console");
  const format = useFormatter();
  const [now, setNow] = useState(() => new Date(renderedAt));
  const base = `/org/${officeId}/admin/devices/${device.id}`;
  const [live, setLive] = useState(initial);
  const [pressed, setPressed] = useState<Side | "badge" | null>(null);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(async () => {
    const response = await fetch(`${base}/live`, { cache: "no-store" });
    if (response.ok) setLive((await response.json()) as LiveStatus);
  }, [base]);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) await refresh().catch(() => {});
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 1000);
    return () => clearTimeout(timer);
  }, [refresh]);

  const send = useCallback(
    (command: ConsoleCommand) => {
      if (command.kind === "key" || command.kind === "badge") {
        setPressed(command.kind === "key" ? command.side : "badge");
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setPressed(null), FLASH_MS);
      }
      void sendDeviceCommand(officeId, device.id, command).then((result) => {
        if (!result.success) toast.error(result.error);
        void refresh();
      });
    },
    [officeId, device.id, refresh],
  );

  const forgetWifi = useCallback(() => {
    if (globalThis.confirm(t("forgetWifiConfirm", { name: device.name }))) send({ kind: "forgetWifi" });
  }, [send, t, device.name]);

  const shortcuts = useMemo(
    () => ({
      key: (side: Side) => send({ kind: "key", side }),
      badge: () => setBadgeOpen(true),
      sync: () => send({ kind: "sync" }),
    }),
    [send],
  );
  useDeviceShortcuts(shortcuts, badgeOpen);

  const relative = (iso: string) => format.relativeTime(new Date(iso), now);
  const volts = live.batteryMv != null ? (live.batteryMv / 1000).toFixed(2) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/org/${officeId}/admin/devices`}>
            <ArrowLeft /> {t("back")}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">{device.name}</h1>
        <LivePill live={live} relative={relative} />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => send({ kind: "sync" })}>
            <RefreshCw /> {t("sync")}
            <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">S</kbd>
          </Button>
          <Button variant="outline" size="sm" onClick={() => send({ kind: "restart" })}>
            <Power /> {t("restart")}
          </Button>
          <Button variant="outline" size="sm" onClick={forgetWifi}>
            <WifiOff /> {t("forgetWifi")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-3">
          <DeviceShell
            pressed={pressed === "left" || pressed === "right" ? pressed : null}
            onKey={(side) => send({ kind: "key", side })}
            screen={<Panel base={base} frame={live.frame} />}
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
          <p className="text-center text-xs text-muted-foreground">
            {live.frame ? t("mirror", { when: relative(live.frame.drawnAt) }) : t("preview")}
          </p>
          {!live.reachable && (
            <p className="mx-auto max-w-xl rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
              {t("offlineHint")}
            </p>
          )}
        </div>

        <div className="space-y-4">
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{t("details")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <Detail label={t("firmware")} value={live.firmwareVersion} />
                <Detail label={t("battery")} value={volts && `${volts} V`} />
                <Detail label={t("signal")} value={live.wifiRssi != null ? `${live.wifiRssi} dBm` : null} />
                <Detail label={t("hardwareId")} value={device.hardwareId} mono />
              </dl>
            </CardContent>
          </Card>

          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{t("activity")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              {live.commands.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noActivity")}</p>
              ) : (
                <ul className="space-y-2">
                  {live.commands.map((command) => (
                    <CommandRow key={command.id} command={command} when={relative(command.createdAt)} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">{t("shortcuts")}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * The mirrored panel; before the terminal has sent a frame, the site's own
 * render stands in, dimmed.
 */
function Panel({ base, frame }: { base: string; frame: LiveStatus["frame"] }) {
  const t = useTranslations("devices.console");
  const src = frame ? `${base}/frame?h=${frame.hash}` : `${base}/screen`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- generated per request, not a static asset
    <img
      key={src}
      src={src}
      alt={frame ? t("mirror", { when: "" }) : t("preview")}
      width={800}
      height={480}
      className={cn(
        // Scaled down, smoothing reads better; scaled up on a dense screen, crisp pixels do.
        "size-full mix-blend-multiply select-none [@media(min-resolution:2dppx)]:[image-rendering:pixelated]",
        !frame && "opacity-40",
      )}
      draggable={false}
    />
  );
}

function LivePill({ live, relative }: { live: LiveStatus; relative: (iso: string) => string }) {
  const t = useTranslations("devices.console");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        live.reachable
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "text-muted-foreground",
      )}
    >
      <span className="relative flex size-2">
        {live.reachable && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/70" />}
        <span className={cn("relative size-2 rounded-full", live.reachable ? "bg-emerald-500" : "bg-zinc-400")} />
      </span>
      {live.reachable ? t("live") : t("offline")}
      {!live.reachable && (
        <span className="font-normal">
          · {live.lastSeenAt ? t("lastSeen", { when: relative(live.lastSeenAt) }) : t("neverSeen")}
        </span>
      )}
    </span>
  );
}

function Detail({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-right", mono && "font-mono text-xs leading-5")}>{value ?? "–"}</dd>
    </>
  );
}

function CommandRow({ command, when }: { command: LiveStatus["commands"][number]; when: string }) {
  const t = useTranslations("devices.console");
  const label = {
    KEY: command.arg === "left" ? t("kind.keyLeft") : t("kind.keyRight"),
    BADGE: t("kind.badge", { uid: command.arg ?? "" }),
    SYNC: t("kind.sync"),
    RESTART: t("kind.restart"),
    FORGET_WIFI: t("kind.forgetWifi"),
  }[command.kind];
  const Icon = { waiting: Clock, delivered: Check, dropped: X }[command.status];
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          command.status === "delivered" && "text-emerald-600 dark:text-emerald-400",
          command.status === "waiting" && "animate-pulse text-amber-600 dark:text-amber-400",
          command.status === "dropped" && "text-muted-foreground",
        )}
      />
      <div className="min-w-0">
        <div className="truncate">{label}</div>
        <div className="text-xs text-muted-foreground">
          {t(`status.${command.status}`)} · {when}
        </div>
      </div>
    </li>
  );
}
