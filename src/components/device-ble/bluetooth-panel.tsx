"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Bluetooth, BluetoothOff, Cpu, Loader2, RefreshCw, RotateCcw, Upload } from "lucide-react";
import {
  BleDevice,
  commands,
  isSupported,
  type DeviceEvent,
  type DeviceInfo,
  type LinkError,
} from "@matecrew/device-ui/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bluetoothLinkStatus, prepareBluetoothLink } from "@/app/org/[officeId]/admin/devices/bluetooth/actions";

const OTHER = "__other__";
const LOG_MAX = 200;
/** How often the page asks the site whether the terminal linked, and for how long. */
const LINK_POLL_MS = 3000;
const LINK_WAIT_MS = 10 * 60 * 1000;

/** A thin React layer over `@matecrew/device-link`: connect, set up, control, log, update. */
export function BluetoothPanel({ officeId }: { readonly officeId: string }) {
  const t = useTranslations("deviceBluetooth");
  const [supported, setSupported] = useState<boolean | null>(null);
  const [device, setDevice] = useState<BleDevice | null>(null);
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [connecting, startConnecting] = useTransition();

  useEffect(() => {
    void isSupported().then(setSupported);
  }, []);

  const report = useCallback(
    (error: LinkError) => {
      if (error.code !== "cancelled") toast.error(t(`errors.${error.code}`, { message: error.message }));
    },
    [t],
  );

  const refresh = useCallback(
    async (target: BleDevice) => {
      const read = await target.info();
      if (read.ok) setInfo(read.value);
      else report(read.error);
    },
    [report],
  );

  const connect = () =>
    startConnecting(async () => {
      const picked = await BleDevice.request();
      if (!picked.ok) return report(picked.error);
      picked.value.onDisconnect(() => {
        toast.info(t("disconnected"));
        setDevice(null);
        setInfo(null);
      });
      setDevice(picked.value);
      await refresh(picked.value);
    });

  if (supported === false) {
    return (
      <Alert>
        <BluetoothOff />
        <AlertDescription>{t("unsupported")}</AlertDescription>
      </Alert>
    );
  }

  if (!device) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 pt-6">
          <Button onClick={connect} disabled={connecting || supported === null}>
            {connecting ? <Loader2 className="animate-spin" /> : <Bluetooth />}
            {connecting ? t("connecting") : t("connect")}
          </Button>
          <p className="text-sm text-muted-foreground">{t("pairingHint")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Cpu className="size-5" /> {info?.name ?? device.name}
            </CardTitle>
            <CardDescription>{t("pairingHint")}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" aria-label="refresh" onClick={() => void refresh(device)}>
              <RefreshCw />
            </Button>
            <Button variant="outline" onClick={() => device.disconnect()}>
              {t("disconnect")}
            </Button>
          </div>
        </CardHeader>
        {info && (
          <CardContent>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Fact label={t("info.firmware")} value={`${info.firmware.version} · ${info.firmware.build}`} />
              <Fact label={t("info.hardwareId")} value={info.hardwareId} mono />
              <Fact label={t("info.wifi")} value={info.wifi ? `${info.wifi.ssid}${info.wifi.rssi != null ? ` · ${info.wifi.rssi} dBm` : ""}` : "—"} />
              <Fact label={t("info.site")} value={info.site ?? "—"} />
              <div className="flex items-center gap-2 sm:col-span-2">
                <Badge variant={info.linked ? "default" : "outline"}>{info.linked ? t("info.linked") : t("info.notLinked")}</Badge>
                <span className="text-muted-foreground">{t("info.uptime", { minutes: Math.floor(info.uptime / 60) })}</span>
              </div>
            </dl>
          </CardContent>
        )}
      </Card>

      {info && (info.setupOpen ? <SetupCard officeId={officeId} device={device} info={info} onError={report} /> : (
        <p className="text-sm text-muted-foreground">{t("setup.alreadyLinked")}</p>
      ))}

      <ControlCard device={device} onError={report} />
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 sm:block">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{value}</dd>
    </div>
  );
}

type SetupState = { step: "form" } | { step: "sending" } | { step: "waiting" } | { step: "linked"; deviceId: string } | { step: "timeout" };

/** Wi-Fi, this site's address and a pre-approved link in one write, then wait for the link. */
function SetupCard({ officeId, device, info, onError }: { officeId: string; device: BleDevice; info: DeviceInfo; onError: (error: LinkError) => void }) {
  const t = useTranslations("deviceBluetooth");
  const [network, setNetwork] = useState(info.networks[0] ?? OTHER);
  const [state, setState] = useState<SetupState>({ step: "form" });
  const stopped = useRef(false);

  useEffect(() => () => void (stopped.current = true), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ssid = network === OTHER ? String(form.get("ssid") ?? "").trim() : network;
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim() || t("setup.defaultName");
    setState({ step: "sending" });

    const since = new Date().toISOString();
    const prepared = await prepareBluetoothLink({ officeId, hardwareId: info.hardwareId, name });
    if (!prepared.ok) {
      toast.error(t(prepared.error === "forbidden" ? "errors.forbidden" : "errors.invalid", { message: "" }));
      return setState({ step: "form" });
    }
    const sent = await device.provision({ ssid, password, site: window.location.origin, secret: prepared.secret });
    if (!sent.ok) {
      onError(sent.error);
      return setState({ step: "form" });
    }
    setState({ step: "waiting" });
    const deadline = Date.now() + LINK_WAIT_MS;
    while (!stopped.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, LINK_POLL_MS));
      const linked = await bluetoothLinkStatus({ officeId, hardwareId: info.hardwareId, since });
      if (linked) return setState({ step: "linked", deviceId: linked.deviceId });
    }
    if (!stopped.current) setState({ step: "timeout" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("setup.title")}</CardTitle>
        <CardDescription>{t("setup.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {state.step === "waiting" && (
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> {t("setup.waiting")}
          </p>
        )}
        {state.step === "linked" && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>{t("setup.linked")}</span>
            <Button asChild size="sm">
              <Link href={`/org/${officeId}/admin/devices/${state.deviceId}`}>{t("setup.openDevice")}</Link>
            </Button>
          </div>
        )}
        {state.step === "timeout" && <p className="text-sm text-muted-foreground">{t("setup.timeout")}</p>}
        {(state.step === "form" || state.step === "sending") && (
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ble-network">{t("setup.network")}</Label>
              <Select value={network} onValueChange={setNetwork}>
                <SelectTrigger id="ble-network" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {info.networks.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER}>{t("setup.otherNetwork")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {network === OTHER && (
              <div className="space-y-2">
                <Label htmlFor="ble-ssid">{t("setup.ssid")}</Label>
                <Input id="ble-ssid" name="ssid" required maxLength={32} autoComplete="off" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="ble-password">{t("setup.password")}</Label>
              <Input id="ble-password" name="password" type="password" maxLength={64} autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ble-name">{t("setup.name")}</Label>
              <Input id="ble-name" name="name" maxLength={60} placeholder={t("setup.defaultName")} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={state.step === "sending"}>
                {state.step === "sending" ? <Loader2 className="animate-spin" /> : <Bluetooth />}
                {state.step === "sending" ? t("setup.sending") : t("setup.submit")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** Keys, badge, sync, restart, the live log, and a firmware upload. */
function ControlCard({ device, onError }: { device: BleDevice; onError: (error: LinkError) => void }) {
  const t = useTranslations("deviceBluetooth");
  const [log, setLog] = useState<Extract<DeviceEvent, { t: "log" }>[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, startBusy] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      device.onEvent((event) => {
        if (event.t === "log") setLog((lines) => [event, ...lines].slice(0, LOG_MAX));
        if (event.t === "done" && !event.ok && event.error) toast.error(t("errors.refused", { message: event.error }));
      }),
    [device, t],
  );

  const run = (action: () => Promise<{ ok: boolean; error?: LinkError }>) =>
    startBusy(async () => {
      const done = await action();
      if (!done.ok && done.error) onError(done.error);
    });

  function sendBadge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const uid = String(new FormData(event.currentTarget).get("uid") ?? "").trim();
    if (uid) run(() => commands.badge(device, uid));
  }

  function upload() {
    const chosen = file.current?.files?.[0];
    if (!chosen) return;
    startBusy(async () => {
      setProgress(0);
      const image = new Uint8Array(await chosen.arrayBuffer());
      const done = await device.updateFirmware(image, { onProgress: (sent, total) => setProgress(Math.round((sent * 100) / total)) });
      setProgress(null);
      if (done.ok) toast.success(t("control.updated"));
      else onError(done.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("control.title")}</CardTitle>
        <CardDescription>{t("control.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => run(() => commands.press(device, "left"))}>
            {t("control.left")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => run(() => commands.press(device, "right"))}>
            {t("control.right")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => run(() => commands.both(device))}>
            {t("control.both")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => run(() => commands.sync(device))}>
            <RefreshCw /> {t("control.sync")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => run(() => commands.restart(device))}>
            <RotateCcw /> {t("control.restart")}
          </Button>
        </div>

        <form onSubmit={sendBadge} className="flex flex-wrap items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="ble-uid">{t("control.badge")}</Label>
            <Input id="ble-uid" name="uid" className="w-56 font-mono" placeholder="04A1B2C3D4E5F6" autoComplete="off" />
          </div>
          <Button type="submit" variant="outline" disabled={busy}>
            {t("control.sendBadge")}
          </Button>
        </form>

        <div className="space-y-2">
          <Label htmlFor="ble-firmware">{t("control.firmware")}</Label>
          <p className="text-sm text-muted-foreground">{t("control.firmwareHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input id="ble-firmware" ref={file} type="file" accept=".bin,application/octet-stream" className="w-72" />
            <Button variant="outline" disabled={busy} onClick={upload}>
              <Upload /> {t("control.upload")}
            </Button>
          </div>
          {progress !== null && (
            <div className="space-y-1">
              <Progress value={progress} />
              <p className="text-sm text-muted-foreground">{t("control.uploading", { percent: progress })}</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>{t("control.log")}</Label>
          <div className="h-64 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs">
            {log.length === 0 ? (
              <p className="text-muted-foreground">{t("control.logEmpty")}</p>
            ) : (
              log.map((line, index) => (
                <div key={log.length - index} className={line.level === "E" || line.level === "W" ? "font-semibold" : "opacity-80"}>
                  {line.level} {line.target}: {line.msg}
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
