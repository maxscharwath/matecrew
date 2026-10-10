"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { toast } from "sonner";
import { BatteryLow, BatteryMedium, Bluetooth, Cpu, Nfc, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignBadge } from "@/app/org/[officeId]/admin/devices/actions";
import { FrameThumbnail } from "@/components/device-console/frame-canvas";

const LOW_BATTERY_MV = 3500;

interface DeviceRow {
  id: string;
  name: string;
  virtual: boolean;
  batteryMv: number | null;
  lastSeenAt: string | null;
  online: boolean;
  /** Set once the terminal has sent what its panel shows. */
  frameHash: string | null;
}

type BadgeRow = {
  id: string;
  uid: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Takes the terminals recorded with it. */
  takes: number;
  user: { id: string; name: string } | null;
};

interface Props {
  readonly officeId: string;
  readonly linkUrl: string;
  readonly members: { id: string; name: string }[];
  readonly badges: BadgeRow[];
  readonly devices: DeviceRow[];
}

/** Rough LiPo charge from its voltage, as on the terminal's screen. */
function batteryPercent(mv: number): number {
  return Math.round(Math.min(100, Math.max(0, ((mv - 3300) / (4150 - 3300)) * 100)));
}

export function DevicesManager({ officeId, linkUrl, members, badges, devices }: Props) {
  const t = useTranslations("devices");
  const tBluetooth = useTranslations("deviceBluetooth");
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        <LinkDevice linkUrl={linkUrl} />
        <Button asChild variant="outline">
          <Link href={`/org/${officeId}/admin/devices/virtual`}>
            <Cpu /> {t("virtual.open")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/org/${officeId}/admin/devices/bluetooth`}>
            <Bluetooth /> {tBluetooth("open")}
          </Link>
        </Button>
      </div>

      {devices.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {devices.map((device) => (
            <DeviceTile key={device.id} officeId={officeId} device={device} />
          ))}
        </div>
      )}

      <Badges officeId={officeId} badges={badges} members={members} />
    </div>
  );
}

function LinkDevice({ linkUrl }: { linkUrl: string }) {
  const t = useTranslations("devices");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button>
          <Plus /> {t("linkDevice")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm">
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>{t("linkStep1")}</li>
          <li>{t("linkStep2")}</li>
          <li>{t("linkStep3", { url: linkUrl })}</li>
        </ol>
      </PopoverContent>
    </Popover>
  );
}

/** A terminal as it looks right now and whether it is reachable; opens its page. */
function DeviceTile({ officeId, device }: { officeId: string; device: DeviceRow }) {
  const t = useTranslations("devices");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const base = `/org/${officeId}/admin/devices/${device.id}`;
  const lowBattery = device.batteryMv != null && device.batteryMv < LOW_BATTERY_MV;

  return (
    <Link
      href={base}
      className="overflow-hidden rounded-xl border bg-card transition-colors outline-none hover:border-foreground/30 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="aspect-[800/480] border-b bg-[#f4f2ec]">
        {device.frameHash && <FrameThumbnail url={`${base}/frame?h=${device.frameHash}`} />}
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={cn("size-2 shrink-0 rounded-full", device.online ? "bg-emerald-500" : "bg-zinc-400")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate font-medium">
            {device.name}
            {device.virtual && <Badge variant="secondary">{t("virtualBadge")}</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">
            {device.online
              ? t("console.live")
              : device.lastSeenAt
                ? t("console.lastSeen", { when: format.relativeTime(new Date(device.lastSeenAt), now) })
                : t("console.neverSeen")}
          </div>
        </div>
        {device.batteryMv != null && (
          <span className={cn("flex items-center gap-1 text-xs", lowBattery ? "text-destructive" : "text-muted-foreground")}>
            {lowBattery ? <BatteryLow className="size-4" /> : <BatteryMedium className="size-4" />}
            {batteryPercent(device.batteryMv)} %
          </span>
        )}
      </div>
    </Link>
  );
}

/** Value of the holder select that means "nobody". */
const NOBODY = "__nobody";

/**
 * Every badge a terminal has read, last pass first. Members link their own
 * badge by scanning the QR the terminal shows for an unknown one; the select
 * is for an admin to assign, reassign or remove one.
 */
function Badges({ officeId, badges, members }: { officeId: string; badges: BadgeRow[]; members: Props["members"] }) {
  const t = useTranslations("devices");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [pending, startTransition] = useTransition();

  const assign = (badgeId: string, userId: string | null) =>
    startTransition(async () => {
      const result = await assignBadge(officeId, badgeId, userId);
      if (result.success) toast.success(userId ? t("badgeAssigned") : t("badgeUnassignedToast"));
      else toast.error(result.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Nfc className="size-5" /> {t("badgesTitle")}
        </CardTitle>
        <CardDescription>{t("badgesSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {badges.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("badgesEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {badges.map((badge) => (
              <li key={badge.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className={cn("font-medium", !badge.user && "text-muted-foreground")}>
                    {badge.user?.name ?? t("badgeUnassigned")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("badgeLastPass", { when: format.relativeTime(new Date(badge.lastSeenAt), now) })}
                    {" · "}
                    {t("badgeTakes", { count: badge.takes })}
                    {" · "}
                    {t("badgeFirstSeen", { when: format.dateTime(new Date(badge.firstSeenAt), { dateStyle: "short" }) })}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{badge.uid}</div>
                </div>
                <Select
                  disabled={pending}
                  value={badge.user?.id ?? NOBODY}
                  onValueChange={(value) => assign(badge.id, value === NOBODY ? null : value)}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder={t("assignTo")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOBODY}>{t("badgeUnassigned")}</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
