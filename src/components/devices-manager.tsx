"use client";

import { useState, useTransition } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { toast } from "sonner";
import { BatteryLow, BatteryMedium, Nfc, Tablet, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assignBadge, revokeDevice, updateDevice } from "@/app/org/[officeId]/admin/devices/actions";

const LOW_BATTERY_MV = 3500;

type KeyAction = "TAKE" | "RETURN";

interface DeviceRow {
  id: string;
  name: string;
  hardwareId: string;
  leftAction: KeyAction;
  leftItemId: string | null;
  leftLabel: string | null;
  rightAction: KeyAction;
  rightItemId: string | null;
  rightLabel: string | null;
  syncTimes: string[];
  firmwareVersion: string | null;
  batteryMv: number | null;
  lastSeenAt: string | null;
  takes: {
    id: string;
    action: KeyAction;
    who: string;
    item: string | null;
    rejectedReason: string | null;
    takenAt: string;
  }[];
}

interface Props {
  readonly officeId: string;
  readonly linkUrl: string;
  readonly items: { id: string; name: string }[];
  readonly members: { id: string; name: string }[];
  readonly badges: { id: string; uid: string; lastSeenAt: string; user: { id: string; name: string } | null }[];
  readonly devices: DeviceRow[];
}

export function DevicesManager({ officeId, linkUrl, items, members, badges, devices }: Props) {
  const t = useTranslations("devices");
  return (
    <div className="space-y-6">
      {devices.length === 0 && <p className="text-muted-foreground">{t("empty")}</p>}
      {devices.map((device) => (
        <DeviceCard key={device.id} officeId={officeId} device={device} items={items} />
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tablet className="size-5" /> {t("linkHintTitle")}
          </CardTitle>
          <CardDescription>{t("linkHint", { url: linkUrl })}</CardDescription>
        </CardHeader>
      </Card>

      <BadgesCard officeId={officeId} badges={badges} members={members} />
    </div>
  );
}

function DeviceCard({
  officeId,
  device,
  items,
}: {
  officeId: string;
  device: DeviceRow;
  items: { id: string; name: string }[];
}) {
  const t = useTranslations("devices");
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [pending, startTransition] = useTransition();
  const [previewKey, setPreviewKey] = useState(0);
  const volts = device.batteryMv != null ? (device.batteryMv / 1000).toFixed(2) : null;
  const batteryLow = device.batteryMv != null && device.batteryMv < LOW_BATTERY_MV;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {device.name}
          {device.firmwareVersion && (
            <Badge variant="secondary">{t("firmware", { version: device.firmwareVersion })}</Badge>
          )}
          {volts && (
            <Badge variant={batteryLow ? "destructive" : "outline"} className="gap-1">
              {batteryLow ? <BatteryLow className="size-3" /> : <BatteryMedium className="size-3" />}
              {batteryLow ? t("batteryLow", { volts }) : t("battery", { volts })}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {device.lastSeenAt
            ? t("lastSeen", { when: format.relativeTime(new Date(device.lastSeenAt), now) })
            : t("neverSeen")}
          {" · "}
          <span className="font-mono">{device.hardwareId}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="text-sm font-medium">{t("preview")}</div>
          {/* eslint-disable-next-line @next/next/no-img-element -- generated per request, not a static asset */}
          <img
            src={`/org/${officeId}/admin/devices/${device.id}/screen?v=${previewKey}`}
            alt={t("preview")}
            width={800}
            height={480}
            className="w-full rounded-md border bg-white"
          />
          <p className="text-xs text-muted-foreground">{t("previewHint")}</p>
        </div>

        <form
          className="space-y-4"
          action={(formData) =>
            startTransition(async () => {
              const result = await updateDevice(officeId, device.id, formData);
              if (result.success) {
                toast.success(t("saved"));
                setPreviewKey((k) => k + 1);
              } else {
                toast.error(result.error);
              }
            })
          }
        >
          <div className="space-y-2">
            <Label htmlFor={`name-${device.id}`}>{t("name")}</Label>
            <Input id={`name-${device.id}`} name="name" defaultValue={device.name} maxLength={60} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <KeyFields side="left" title={t("leftKey")} device={device} items={items} />
            <KeyFields side="right" title={t("rightKey")} device={device} items={items} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`sync-${device.id}`}>{t("syncTimes")}</Label>
            <Input id={`sync-${device.id}`} name="syncTimes" defaultValue={device.syncTimes.join(", ")} />
            <p className="text-xs text-muted-foreground">{t("syncTimesHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {tc("save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (!globalThis.confirm(t("revokeConfirm", { name: device.name }))) return;
                startTransition(async () => {
                  await revokeDevice(officeId, device.id);
                  toast.success(t("revoked"));
                });
              }}
            >
              <Unlink className="size-4" /> {t("revoke")}
            </Button>
          </div>
        </form>

        {device.takes.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">{t("recentTakes")}</div>
            <ul className="space-y-1 text-sm">
              {device.takes.map((take) => (
                <li key={take.id} className="flex justify-between gap-4">
                  <span>
                    {take.who} · {take.action === "TAKE" ? t("actionTake") : t("actionReturn")}
                    {take.item && ` · ${take.item}`}
                    {take.rejectedReason && (
                      <span className="text-destructive"> · {t("takeRejected", { reason: take.rejectedReason })}</span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {format.dateTime(new Date(take.takenAt), { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KeyFields({
  side,
  title,
  device,
  items,
}: {
  side: "left" | "right";
  title: string;
  device: DeviceRow;
  items: { id: string; name: string }[];
}) {
  const t = useTranslations("devices");
  const action = side === "left" ? device.leftAction : device.rightAction;
  const itemId = side === "left" ? device.leftItemId : device.rightItemId;
  const label = side === "left" ? device.leftLabel : device.rightLabel;
  const [currentAction, setCurrentAction] = useState<KeyAction>(action);
  const [currentItem, setCurrentItem] = useState(itemId ?? "none");
  const itemName = items.find((i) => i.id === currentItem)?.name;
  const verb = currentAction === "TAKE" ? t("actionTake") : t("actionReturn");
  const example = itemName ? `${verb} · ${itemName}` : verb;

  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <div className="space-y-1">
        <Label>{t("action")}</Label>
        <Select name={`${side}Action`} value={currentAction} onValueChange={(v) => setCurrentAction(v as KeyAction)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TAKE">{t("actionTake")}</SelectItem>
            <SelectItem value="RETURN">{t("actionReturn")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>{t("item")}</Label>
        <Select name={`${side}ItemId`} value={currentItem} onValueChange={setCurrentItem}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {items.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${side}-label-${device.id}`}>{t("label")}</Label>
        <Input
          id={`${side}-label-${device.id}`}
          name={`${side}Label`}
          defaultValue={label ?? ""}
          placeholder={t("labelPlaceholder", { example })}
          maxLength={40}
        />
      </div>
    </fieldset>
  );
}

function BadgesCard({
  officeId,
  badges,
  members,
}: {
  officeId: string;
  badges: Props["badges"];
  members: Props["members"];
}) {
  const t = useTranslations("devices");
  const format = useFormatter();
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
              <li key={badge.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <div className="font-mono text-sm">{badge.uid}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("badgeSeen", { when: format.dateTime(new Date(badge.lastSeenAt), { dateStyle: "short", timeStyle: "short" }) })}
                  </div>
                </div>
                {badge.user ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{badge.user.name}</span>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => assign(badge.id, null)}>
                      {t("unassign")}
                    </Button>
                  </div>
                ) : (
                  <Select disabled={pending} onValueChange={(userId) => assign(badge.id, userId)}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder={t("assignTo")} />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
