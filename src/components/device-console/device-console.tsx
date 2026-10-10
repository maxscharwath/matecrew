"use client";

import { ScreenControl } from "./screen-control";
import { ScreenPreview } from "./screen-preview";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Ellipsis, Power, RefreshCw, Unlink, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { revokeDevice, sendDeviceCommand, updateDevice } from "@/app/org/[officeId]/admin/devices/actions";
import type { ConsoleCommand } from "@/lib/device/commands";
import type { LiveStatus } from "@/lib/device/live";
import {
  BadgeZone,
  DeviceShell,
  useDeviceShortcuts,
  type BadgeOption,
  type Side,
} from "@/components/device-console/device-shell";

type Take = { id: string; who: string; item: string | null; rejectedReason: string | null; takenAt: string };

interface Props {
  readonly officeId: string;
  readonly device: { id: string; name: string; hardwareId: string; firstItemId: string | null };
  readonly items: { id: string; name: string }[];
  readonly badges: BadgeOption[];
  readonly takes: Take[];
  readonly initial: LiveStatus;
  /** When the server rendered the page: relative times start from it, so hydration matches. */
  readonly renderedAt: string;
}

/** How long a key or the badge zone stays lit after a press. */
const FLASH_MS = 700;

/**
 * One terminal: its panel mirrored live with its keys and badge reader driven
 * from here, its settings, and its last takes.
 */
export function DeviceConsole({ officeId, device, items, badges, takes, initial, renderedAt }: Props) {
  const t = useTranslations("devices.console");
  const td = useTranslations("devices");
  const format = useFormatter();
  const router = useRouter();
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
  const waiting = live.commands.filter((c) => c.status === "waiting").length;
  const facts = [
    live.frame && t("mirror", { when: relative(live.frame.drawnAt) }),
    live.firmwareVersion && `${t("firmware")} ${live.firmwareVersion}`,
    live.batteryMv != null && `${(live.batteryMv / 1000).toFixed(2)} V`,
    live.wifiRssi != null && `${live.wifiRssi} dBm`,
    device.hardwareId,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/org/${officeId}/admin/devices`}>
            <ArrowLeft /> {t("back")}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">{device.name}</h1>
        <LivePill live={live} waiting={waiting} relative={relative} />
        <div className="ml-auto flex gap-2">
          <Select onValueChange={(app: "mate" | "showcase") => send({ kind: "sync", app })}>
            <SelectTrigger className="w-36" aria-label={t("application")}><SelectValue placeholder={t("application")} /></SelectTrigger>
            <SelectContent><SelectItem value="mate">maté</SelectItem><SelectItem value="showcase">Showcase</SelectItem></SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => send({ kind: "sync" })} title={t("shortcuts")}>
            <RefreshCw /> {t("sync")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label={t("more")}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => send({ kind: "restart" })}>
                <Power /> {t("restart")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (globalThis.confirm(t("forgetWifiConfirm", { name: device.name }))) send({ kind: "forgetWifi" });
                }}
              >
                <WifiOff /> {t("forgetWifi")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={async () => {
                  if (!globalThis.confirm(td("revokeConfirm", { name: device.name }))) return;
                  await revokeDevice(officeId, device.id);
                  toast.success(td("revoked"));
                  router.push(`/org/${officeId}/admin/devices`);
                }}
              >
                <Unlink /> {td("revoke")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-3">
        <DeviceShell
          pressed={pressed === "left" || pressed === "right" ? pressed : null}
          onKey={(side) => send({ kind: "key", side })}
          screen={<ScreenControl label={t("tapScreen")} onTap={(x,y) => send({ kind: "tap", x, y })}><Panel base={base} frame={live.frame} /></ScreenControl>}
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
          {live.reachable ? facts.join(" · ") : t("offlineHint")}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Settings officeId={officeId} device={device} items={items} />
        <Takes takes={takes} />
      </div>
    </div>
  );
}

/** Mirror the panel; before its first upload, preview the definition with Rust/Wasm. */
function Panel({ base, frame }: { base: string; frame: LiveStatus["frame"] }) {
  const t = useTranslations("devices.console");
  if (!frame) {
    return <ScreenPreview url={`${base}/screen`} placeholder={t("noFrame")} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- generated per request, not a static asset
    <img
      src={`${base}/frame?h=${frame.hash}`}
      alt=""
      width={800}
      height={480}
      className="size-full mix-blend-multiply select-none [@media(min-resolution:2dppx)]:[image-rendering:pixelated]"
      draggable={false}
    />
  );
}

function LivePill({ live, waiting, relative }: { live: LiveStatus; waiting: number; relative: (iso: string) => string }) {
  const t = useTranslations("devices.console");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        live.reachable ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
      )}
    >
      <span className="relative flex size-2">
        {live.reachable && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/70" />}
        <span className={cn("relative size-2 rounded-full", live.reachable ? "bg-emerald-500" : "bg-zinc-400")} />
      </span>
      {live.reachable ? t("live") : t("offline")}
      {!live.reachable && (
        <span className="font-normal">· {live.lastSeenAt ? t("lastSeen", { when: relative(live.lastSeenAt) }) : t("neverSeen")}</span>
      )}
      {waiting > 0 && <span className="font-normal">· {t("waiting", { count: waiting })}</span>}
    </span>
  );
}

/** What there is to set: its name, and the item the picker opens on. */
function Settings({ officeId, device, items }: { officeId: string; device: Props["device"]; items: Props["items"] }) {
  const t = useTranslations("devices");
  const [pending, startTransition] = useTransition();
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">{t("settings")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          action={(formData) =>
            startTransition(async () => {
              const result = await updateDevice(officeId, device.id, formData);
              if (result.success) toast.success(t("saved"));
              else toast.error(result.error);
            })
          }
        >
          <div className="space-y-2">
            <Label htmlFor="device-name">{t("name")}</Label>
            <Input id="device-name" name="name" defaultValue={device.name} maxLength={60} />
          </div>
          <div className="space-y-2">
            <Label>{t("firstItem")}</Label>
            <Select name="firstItemId" defaultValue={device.firstItemId ?? items[0]?.id}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Takes({ takes }: { takes: Take[] }) {
  const t = useTranslations("devices");
  const format = useFormatter();
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">{t("recentTakes")}</CardTitle>
      </CardHeader>
      <CardContent>
        {takes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noTakes")}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {takes.map((take) => (
              <li key={take.id} className="flex justify-between gap-4">
                <span className="min-w-0 truncate">
                  {take.who}
                  {take.item && <span className="text-muted-foreground"> · {take.item}</span>}
                  {take.rejectedReason && <span className="text-destructive"> · {t("takeRejected", { reason: take.rejectedReason })}</span>}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {format.dateTime(new Date(take.takenAt), { dateStyle: "short", timeStyle: "short" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
