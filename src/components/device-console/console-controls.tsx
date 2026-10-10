"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, CircuitBoard, Gamepad2, Nfc, Power, RefreshCw, Shuffle, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { asUid, randomUid, type Side } from "./device-shell";

/**
 * What the console can make the terminal do, all through its command queue:
 * the keys, a badge on the reader, a sync or an app, a restart, a Wi-Fi reset.
 */
export function ControlsCard({
  deviceName,
  reachable,
  onKey,
  onBoth,
  onBadge,
  onSync,
  onRestart,
  onForgetWifi,
}: {
  deviceName: string;
  reachable: boolean;
  onKey: (side: Side) => void;
  /** Both keys together: the terminal's about page. */
  onBoth: () => void;
  onBadge: (uid: string) => void;
  onSync: (app?: "mate" | "showcase") => void;
  onRestart: () => void;
  onForgetWifi: () => void;
}) {
  const t = useTranslations("devices.console");
  const [uid, setUid] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [forgetting, setForgetting] = useState(false);

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Gamepad2 className="size-4 text-muted-foreground" /> {t("controls.title")}
        </CardTitle>
        <CardDescription className="text-xs">{reachable ? t("controls.live") : t("offlineHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-4">
        <Group label={t("controls.keys")}>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={() => onKey("left")}>
              <ArrowLeft /> {t("controls.left")}
            </Button>
            <Button variant="outline" size="sm" onClick={onBoth}>
              {t("controls.both")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => onKey("right")}>
              {t("controls.right")} <ArrowRight />
            </Button>
          </div>
        </Group>

        <Group label={t("controls.badge")}>
          <form
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              const normalized = asUid(uid);
              setInvalid(!normalized);
              if (normalized) onBadge(normalized);
            }}
          >
            <div className="flex gap-2">
              <InputGroup className="h-8">
                <InputGroupInput
                  value={uid}
                  onChange={(event) => {
                    setUid(event.target.value);
                    setInvalid(false);
                  }}
                  placeholder="04A1B2C3D4E5F6"
                  aria-label={t("controls.uid")}
                  aria-invalid={invalid}
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={32}
                  className="font-mono text-xs tracking-wider uppercase"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={t("controls.randomUid")}
                    title={t("controls.randomUid")}
                    onClick={() => {
                      setUid(randomUid());
                      setInvalid(false);
                    }}
                  >
                    <Shuffle />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <Button type="submit" variant="outline" size="sm">
                <Nfc /> {t("controls.tap")}
              </Button>
            </div>
            <p className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>
              {invalid ? t("invalidUid") : t("controls.badgeHint")}
            </p>
          </form>
        </Group>

        <Group label={t("controls.terminal")}>
          <div className="grid grid-cols-2 gap-2">
            {/* An action, not a setting: it keeps showing its placeholder. */}
            <Select value="" onValueChange={(app: "mate" | "showcase") => onSync(app)}>
              <SelectTrigger size="sm" className="col-span-2 w-full" aria-label={t("application")}>
                <SelectValue placeholder={t("controls.openApp")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mate">maté</SelectItem>
                <SelectItem value="showcase">Showcase</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => onSync()}>
              <RefreshCw /> {t("sync")}
            </Button>
            <Button variant="outline" size="sm" onClick={onRestart}>
              <Power /> {t("restart")}
            </Button>
            <Button variant="outline" size="sm" className="col-span-2" onClick={() => setForgetting(true)}>
              <WifiOff /> {t("forgetWifi")}
            </Button>
          </div>
        </Group>
      </CardContent>
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
    </Card>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</div>
      {children}
    </div>
  );
}

/** The terminal's pads, as soldered (device/board/src/lib.rs). */
const PINS = [
  { pad: "D0", gpio: 1, role: "panelRst" },
  { pad: "D1", gpio: 2, role: "panelCs" },
  { pad: "D2", gpio: 3, role: "panelBusy" },
  { pad: "D3", gpio: 4, role: "panelDc" },
  { pad: "D4", gpio: 5, role: "keyLeft" },
  { pad: "D5", gpio: 6, role: "buzzer" },
  { pad: "D6", gpio: 43, role: "nfcSda" },
  { pad: "D7", gpio: 44, role: "nfcScl" },
  { pad: "D8", gpio: 7, role: "panelSck" },
  { pad: "D9", gpio: 8, role: "keyRight" },
  { pad: "D10", gpio: 9, role: "panelMosi" },
] as const;

/**
 * The board and its wiring, like the studio's: the pads light up while the
 * console drives them (a key, a badge, a refresh of the mirror).
 */
export function BoardCard({
  hardwareId,
  firmwareVersion,
  active,
}: {
  hardwareId: string;
  firmwareVersion: string | null;
  active: ReadonlySet<number>;
}) {
  const t = useTranslations("devices.console");
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CircuitBoard className="size-4 text-muted-foreground" /> XIAO ESP32-S3
        </CardTitle>
        <CardDescription className="text-xs">{t("board.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{t("hardwareId")}</dt>
          <dd className="truncate text-right font-mono">{hardwareId}</dd>
          <dt className="text-muted-foreground">{t("firmware")}</dt>
          <dd className="truncate text-right font-mono">{firmwareVersion ?? "—"}</dd>
        </dl>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="w-4 py-1 font-normal" aria-hidden />
              <th className="py-1 font-normal">{t("board.pad")}</th>
              <th className="py-1 font-normal">GPIO</th>
              <th className="py-1 font-normal">{t("board.function")}</th>
            </tr>
          </thead>
          <tbody>
            {PINS.map((pin) => {
              const on = active.has(pin.gpio);
              return (
                <tr key={pin.pad} className="border-b border-border/50 last:border-0">
                  <td className="py-1">
                    <span
                      className={cn(
                        "block size-2 rounded-full bg-muted-foreground/25 transition-colors",
                        on && "bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500",
                      )}
                    />
                  </td>
                  <td className="py-1 font-mono">{pin.pad}</td>
                  <td className="py-1 font-mono tabular-nums">{pin.gpio}</td>
                  <td className={cn("py-1 text-muted-foreground", on && "text-foreground")}>{t(`board.pins.${pin.role}`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
