"use client";

import { useRef, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Info, LoaderCircle, Power, RefreshCw, Upload, WifiOff, X, Zap } from "lucide-react";
import { imageVersion } from "@matecrew/device-ui/link";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RailCard } from "./workbench";

type App = "mate" | "showcase";

/**
 * What can be asked of the terminal besides its keys and reader: a sync, the about page, an app,
 * a restart, forgetting its Wi-Fi, and (over Bluetooth) a new firmware. Only the actions given
 * show.
 */
export function ActionsCard({
  deviceName,
  description,
  onSync,
  onBoth,
  onOpenApp,
  onRestart,
  onForgetWifi,
  onFirmware,
}: Readonly<{
  deviceName: string;
  description?: ReactNode;
  onSync?: () => void;
  /** Both keys together: the terminal's about page. */
  onBoth?: () => void;
  onOpenApp?: (app: App) => void;
  onRestart?: () => void;
  onForgetWifi?: () => void;
  /** Sends a firmware image, reporting its progress in percent; resolves once done or failed. */
  onFirmware?: (image: Uint8Array, progress: (percent: number) => void) => Promise<void>;
}>) {
  const t = useTranslations("devices.console.actions");
  const [forgetting, setForgetting] = useState(false);
  return (
    <RailCard icon={<Zap />} title={t("title")} description={description}>
      <div className="grid grid-cols-2 gap-2">
        {onSync && (
          <Button variant="outline" size="sm" onClick={onSync}>
            <RefreshCw /> {t("sync")}
          </Button>
        )}
        {onRestart && (
          <Button variant="outline" size="sm" onClick={onRestart}>
            <Power /> {t("restart")}
          </Button>
        )}
        {onBoth && (
          <Button variant="outline" size="sm" onClick={onBoth} title={t("aboutHint")}>
            <Info /> {t("about")}
          </Button>
        )}
        {onOpenApp && (
          // An action, not a setting: it keeps showing its placeholder.
          <Select value="" onValueChange={(app: App) => onOpenApp(app)}>
            <SelectTrigger size="sm" className="w-full" aria-label={t("openApp")}>
              <SelectValue placeholder={t("openApp")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mate">maté</SelectItem>
              <SelectItem value="showcase">Showcase</SelectItem>
            </SelectContent>
          </Select>
        )}
        {onForgetWifi && (
          <Button variant="outline" size="sm" className="col-span-2" onClick={() => setForgetting(true)}>
            <WifiOff /> {t("forgetWifi")}
          </Button>
        )}
      </div>
      {onFirmware && <FirmwareUpload onSend={onFirmware} />}
      {onForgetWifi && (
        <ConfirmDialog
          open={forgetting}
          onOpenChange={setForgetting}
          title={t("forgetWifi")}
          description={t("forgetWifiConfirm", { name: deviceName })}
          confirmLabel={t("forgetWifi")}
          onConfirm={() => {
            setForgetting(false);
            onForgetWifi();
          }}
        />
      )}
    </RailCard>
  );
}

type Picked = { name: string; image: Uint8Array; version: string | null };

/** A firmware file, checked as an ESP-IDF image (its version shows) before it is sent. */
function FirmwareUpload({ onSend }: Readonly<{ onSend: (image: Uint8Array, progress: (percent: number) => void) => Promise<void> }>) {
  const t = useTranslations("devices.console.actions");
  const format = useFormatter();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const image = new Uint8Array(await file.arrayBuffer());
    setPicked({ name: file.name, image, version: imageVersion(image) });
  };

  const send = async () => {
    if (!picked) return;
    setProgress(0);
    await onSend(picked.image, setProgress);
    setProgress(null);
    setPicked(null);
    if (input.current) input.current.value = "";
  };

  return (
    <div className="mt-4 space-y-2 border-t pt-4">
      <div className="text-xs font-medium text-muted-foreground">{t("firmware")}</div>
      <input
        ref={input}
        type="file"
        accept=".bin,application/octet-stream"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      {!picked && (
        <Button variant="outline" size="sm" className="w-full border-dashed" onClick={() => input.current?.click()}>
          <Upload /> {t("chooseFirmware")}
        </Button>
      )}
      {picked && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5 text-xs">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono">{picked.name}</div>
              <div className={picked.version ? "text-muted-foreground" : "text-destructive"}>
                {picked.version
                  ? t("firmwareVersion", {
                      version: picked.version,
                      size: format.number(picked.image.length / (1024 * 1024), { maximumFractionDigits: 2 }),
                    })
                  : t("notFirmware")}
              </div>
            </div>
            {progress === null && (
              <Button variant="ghost" size="icon-xs" aria-label={t("cancel")} onClick={() => setPicked(null)}>
                <X />
              </Button>
            )}
          </div>
          {progress === null ? (
            <Button size="sm" className="w-full" disabled={!picked.version} onClick={() => void send()}>
              <Upload /> {t("sendFirmware")}
            </Button>
          ) : (
            <div className="space-y-1">
              <Progress value={progress} />
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" /> {t("uploading", { percent: progress })}
              </p>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("firmwareHint")}</p>
    </div>
  );
}
