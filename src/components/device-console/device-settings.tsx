"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { revokeDevice, updateDevice } from "@/app/org/[officeId]/admin/devices/actions";
import { cn } from "@/lib/utils";
import type { DeviceTheme } from "@/lib/device/contract";

/** The terminal's languages: the site's (src/i18n/request.ts). */
const LANGUAGES = ["fr", "en"] as const;
const THEMES: readonly DeviceTheme[] = ["paper", "dark", "flipper", "macos"];
/** The language choice that follows the office's (`updateDevice`). */
const OFFICE_LOCALE = "office";

export type Take = { id: string; who: string; item: string | null; rejectedReason: string | null; takenAt: string };

export type DeviceSettingsProps = {
  officeId: string;
  device: { id: string; name: string; firstItemId: string | null; locale: string | null; theme: string | null };
  /** What a terminal without its own language and theme shows. */
  display: { officeLocale: string; defaultTheme: DeviceTheme };
  items: { id: string; name: string }[];
};

/** What there is to set: its name, the item the picker opens on, its language and theme; and unlinking it. */
export function DeviceSettings({ officeId, device, display, items }: Readonly<DeviceSettingsProps>) {
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
            <DisplayFields device={device} display={display} />
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

/** A language's own name, capitalised: "Français", "English". */
function autonym(code: string): string {
  const name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
}

/** The terminal's language and its screens' theme, saved with the rest of the form. */
function DisplayFields({ device, display }: Readonly<Pick<DeviceSettingsProps, "device" | "display">>) {
  const t = useTranslations("devices.display");
  const [theme, setTheme] = useState<string>(device.theme ?? display.defaultTheme);
  const office = useMemo(() => autonym(display.officeLocale), [display.officeLocale]);
  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <div className="text-sm font-medium">{t("title")}</div>
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="device-locale">{t("language")}</Label>
        <Select name="locale" defaultValue={device.locale ?? OFFICE_LOCALE}>
          <SelectTrigger id="device-locale" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OFFICE_LOCALE}>{t("officeLanguage", { language: office })}</SelectItem>
            {LANGUAGES.map((code) => (
              <SelectItem key={code} value={code}>
                {autonym(code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{t("theme")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((value) => (
            <label
              key={value}
              className={cn(
                "relative flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 outline-none hover:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                theme === value && "border-foreground/40 bg-accent",
              )}
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => setTheme(value)}
                className="sr-only"
              />
              <ThemeSwatch theme={value} sample={t("sample")} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t(`themes.${value}`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {value === display.defaultTheme ? t("default") : t(`themeHints.${value}`)}
                </span>
              </span>
              {theme === value && <Check className="absolute top-2 right-2 size-3.5" />}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** A thumbnail of a theme on the panel: its ground, its ink and the feel of its type. */
function ThemeSwatch({ theme, sample }: Readonly<{ theme: DeviceTheme; sample: string }>) {
  const ground = {
    paper: "bg-[#f4f2ec] text-zinc-900",
    dark: "bg-zinc-900 text-[#f4f2ec]",
    flipper: "bg-[#f4f2ec] text-zinc-900 font-mono uppercase",
    macos: "bg-white text-zinc-900 font-serif",
  }[theme];
  return (
    <span className={cn("relative grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded border border-zinc-400 text-sm font-semibold", ground)}>
      {theme === "macos" && (
        <span className="absolute inset-x-0 top-0 h-2 bg-[repeating-linear-gradient(0deg,#18181b_0_1px,transparent_1px_2px)]" />
      )}
      {theme === "flipper" && <span className="absolute inset-0.5 rounded-sm border border-dashed border-zinc-500" />}
      <span className="relative">{sample}</span>
    </span>
  );
}

/** The takes the terminal sent, last first, with why one was refused. */
export function RecentTakes({ takes, timeZone }: Readonly<{ takes: Take[]; timeZone: string }>) {
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
