"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VirtualBuzzer } from "@matecrew/device-ui/emulator";
import type { VirtualDevice } from "@/lib/device/virtual/runtime";
import type { Beep } from "@/lib/device/virtual/wasm";

export function useBuzzerEmulator(device: VirtualDevice, sound: boolean) {
  const player = useRef<VirtualBuzzer | null>(null);
  const [ready, setReady] = useState(false);
  const [volume, setVolume] = useState(30);
  const [last, setLast] = useState<Beep | null>(null);
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const buzzer = new VirtualBuzzer();
    player.current = buzzer;
    return () => {
      player.current = null;
      clearTimeout(timer.current);
      device.setBeep(() => {});
      buzzer.dispose();
    };
  }, [device]);
  useEffect(() => {
    player.current?.setEnabled(sound);
  }, [sound]);
  useEffect(() => {
    player.current?.setVolume(volume / 100);
  }, [volume]);
  const unlock = useCallback(() => {
    void player.current
      ?.unlock()
      .then(setReady)
      .catch(() => setReady(false));
  }, []);
  const play = useCallback(
    (beep: Beep) => {
      const pattern = device.buzzerPattern(beep);
      setLast(beep);
      setActive(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () => setActive(false),
        pattern.reduce((ms, [, duration]) => ms + duration, 0),
      );
      if (sound) setReady(player.current?.play(pattern) ?? false);
    },
    [device, sound],
  );
  useEffect(() => {
    device.setBeep(play);
    return () => device.setBeep(() => {});
  }, [device, play]);
  const test = async (beep: Beep) => {
    if (sound) {
      try {
        setReady(await player.current!.unlock());
      } catch {
        setReady(false);
      }
    }
    device.testBuzzer(beep);
  };
  return {
    ready,
    volume,
    setVolume,
    last,
    active,
    unlock,
    test,
    pattern: last ? device.buzzerPattern(last) : [],
  };
}
export function BuzzerEmulator({
  buzzer,
  sound,
  onSound,
}: {
  buzzer: ReturnType<typeof useBuzzerEmulator>;
  sound: boolean;
  onSound: (value: boolean) => void;
}) {
  const t = useTranslations("devices.virtual.buzzer");
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{t("title")}</span>
          <span
            className={`size-2 rounded-full ${buzzer.active ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onSound(!sound);
              buzzer.unlock();
            }}
          >
            {sound ? <Volume2 /> : <VolumeX />}
            {sound ? t("mute") : t("enable")}
          </Button>
          <span role="status" className="text-xs text-muted-foreground">
            {!sound ? t("muted") : buzzer.ready ? t("ready") : t("activate")}
          </span>
        </div>
        <label className="block space-y-1 text-xs">
          {t("volume", { value: buzzer.volume })}
          <input
            className="w-full accent-primary"
            aria-label={t("volumeLabel")}
            type="range"
            min={0}
            max={100}
            value={buzzer.volume}
            onChange={(e) => buzzer.setVolume(Number(e.target.value))}
          />
        </label>
        <div className="grid grid-cols-2 gap-1">
          {(["key", "accepted", "error", "notification"] as const).map(
            (tone) => (
              <Button
                className="flex-1 px-2"
                variant="outline"
                size="sm"
                key={tone}
                onClick={() => void buzzer.test(tone)}
              >
                {t(tone)}
              </Button>
            ),
          )}
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">
          GPIO 44 · PWM 50 %<br />
          {buzzer.pattern
            .map(([hz, ms]) => `${hz} Hz / ${ms} ms`)
            .join(" → ") || t("idle")}
        </p>
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
      </CardContent>
    </Card>
  );
}
