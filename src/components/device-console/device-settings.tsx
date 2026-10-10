"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { revokeDevice, updateDevice } from "@/app/org/[officeId]/admin/devices/actions";

export type Take = { id: string; who: string; item: string | null; rejectedReason: string | null; takenAt: string };

/** What there is to set: its name and the item the picker opens on; and unlinking it. */
export function DeviceSettings({
  officeId,
  device,
  items,
}: {
  officeId: string;
  device: { id: string; name: string; firstItemId: string | null };
  items: { id: string; name: string }[];
}) {
  const t = useTranslations("devices");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [unlinking, setUnlinking] = useState(false);
  const [revoking, startRevoke] = useTransition();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="text-base">{t("settings")}</CardTitle>
          <CardDescription>{t("console.settingsHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            action={(formData) =>
              startTransition(async () => {
                const result = await updateDevice(officeId, device.id, formData);
                if (result.success) {
                  toast.success(t("saved"));
                  router.refresh();
                } else toast.error(result.error);
              })
            }
          >
            <div className="space-y-2">
              <Label htmlFor="device-name">{t("name")}</Label>
              <Input id="device-name" name="name" defaultValue={device.name} maxLength={60} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-first-item">{t("firstItem")}</Label>
              <Select name="firstItemId" defaultValue={device.firstItemId ?? items[0]?.id}>
                <SelectTrigger id="device-first-item" className="w-full">
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

      <Card className="gap-4 self-start">
        <CardHeader>
          <CardTitle className="text-base">{t("revoke")}</CardTitle>
          <CardDescription>{t("console.unlinkHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setUnlinking(true)}>
            <Unlink /> {t("revoke")}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={unlinking}
        onOpenChange={setUnlinking}
        title={t("revoke")}
        description={t("revokeConfirm", { name: device.name })}
        confirmLabel={t("revoke")}
        isPending={revoking}
        onConfirm={() =>
          startRevoke(async () => {
            const result = await revokeDevice(officeId, device.id);
            if (!result.success) {
              toast.error(result.error);
              return;
            }
            toast.success(t("revoked"));
            router.push(`/org/${officeId}/admin/devices`);
          })
        }
      />
    </div>
  );
}

/** The takes the terminal sent, last first, with why one was refused. */
export function RecentTakes({ takes, timeZone }: { takes: Take[]; timeZone: string }) {
  const t = useTranslations("devices");
  const format = useFormatter();
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">{t("recentTakes")}</CardTitle>
        <CardDescription>{t("console.takesHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        {takes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noTakes")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {takes.map((take) => (
              <li key={take.id} className="flex items-center justify-between gap-4 py-2.5">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{take.who}</span>
                  {take.item && <span className="text-muted-foreground"> · {take.item}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {take.rejectedReason && (
                    <Badge variant="outline" className="text-destructive">
                      {t("takeRejected", { reason: take.rejectedReason })}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {format.dateTime(new Date(take.takenAt), { dateStyle: "short", timeStyle: "short", timeZone })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
