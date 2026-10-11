"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Volume2, VolumeX } from "lucide-react";
import { VirtualBuzzer } from "@matecrew/device-ui/emulator";
import type { BleDevice } from "@matecrew/device-ui/link";
import { Button } from "@/components/ui/button";
import type { Tone } from "../../../realtime/src/protocol";

/** The console's choice, per browser. */
const STORED = "matecrew.console.sound";

function stored(): boolean {
  try {
    return localStorage.getItem(STORED) !== "off";
  } catch {
    return true;
  }
}

/** Consoles open in this browser hear of a change (`storage` only fires in the others). */
const changed = new EventTarget();

function subscribe(onChange: () => void): () => void {
  changed.addEventListener("change", onChange);
  globalThis.addEventListener("storage", onChange);
  return () => {
    changed.removeEventListener("change", onChange);
    globalThis.removeEventListener("storage", onChange);
  };
}

/**
 * The terminal's piezo in the browser: each beep it plays, with its own tones, so the console
 * sounds like the terminal. Over Bluetooth when `ble` is paired and streaming (`bleLive`), else
 * as the relay forwards them (`play`): never both. Browsers start audio only after a gesture: the
 * first click or key on the page turns it on.
 */
export function useConsoleBuzzer(ble: BleDevice | null = null, bleLive = false, relayed = false) {
  const player = useRef<VirtualBuzzer | null>(null);
  // On by default, and on the server: the page renders the same either way.
  const sound = useSyncExternalStore(subscribe, stored, () => true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const buzzer = new VirtualBuzzer();
    player.current = buzzer;
    const unlock = () => {
      void buzzer
        .unlock()
        .then(setReady)
        .catch(() => setReady(false));
    };
    globalThis.addEventListener("pointerdown", unlock, { once: true });
    globalThis.addEventListener("keydown", unlock, { once: true });
    return () => {
      globalThis.removeEventListener("pointerdown", unlock);
      globalThis.removeEventListener("keydown", unlock);
      player.current = null;
      buzzer.dispose();
    };
  }, []);

  useEffect(() => {
    player.current?.setEnabled(sound);
  }, [sound]);

  useEffect(() => {
    if (!ble || !bleLive) return;
    return ble.onEvent((event) => {
      if (event.t === "beep") player.current?.play(event.tones);
    });
  }, [ble, bleLive]);

  /** A beep the relay forwarded; Bluetooth brings it instead while it streams. */
  const play = useCallback(
    (tones: Tone[]) => {
      if (!(ble && bleLive)) player.current?.play(tones);
    },
    [ble, bleLive],
  );

  const toggle = useCallback(() => {
    try {
      localStorage.setItem(STORED, stored() ? "off" : "on");
    } catch {
      // Private window or blocked storage: the sound stays on.
    }
    changed.dispatchEvent(new Event("change"));
    void player.current
      ?.unlock()
      .then(setReady)
      .catch(() => setReady(false));
  }, []);

  /** Whether beeps can come at all: over the relay, or over Bluetooth. */
  const available = relayed || (ble !== null && bleLive);
  return { sound, ready, play, toggle, available };
}

/** Turns the terminal's beeps on or off in this browser. */
export function SoundButton({ buzzer }: Readonly<{ buzzer: ReturnType<typeof useConsoleBuzzer> }>) {
  const t = useTranslations("devices.console.sound");
  let title = t("off");
  if (buzzer.sound) title = buzzer.ready ? t("on") : t("blocked");
  return (
    <Button variant="outline" size="xs" onClick={buzzer.toggle} title={title} aria-pressed={buzzer.sound}>
      {buzzer.sound ? <Volume2 /> : <VolumeX />}
      {buzzer.sound ? t("label") : t("muted")}
    </Button>
  );
}
