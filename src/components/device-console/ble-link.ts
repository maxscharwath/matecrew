"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BleDevice, isSupported, type LinkError } from "@matecrew/device-ui/link";
import { PANEL_HEIGHT, PANEL_WIDTH, type MirrorFrame } from "./frame-bits";

/**
 * The screen a terminal mirrors over Bluetooth, live, as the console's frames; null until the
 * first one comes (watching pairs first: the browser asks for the terminal's code), or with no
 * device. `error` says why it stopped: no mirror in that firmware, pairing refused, link lost.
 */
export function useBleScreen(device: BleDevice | null): { frame: MirrorFrame | null; error: LinkError | null } {
  const [state, setState] = useState<{ device: BleDevice | null; frame: MirrorFrame | null; error: LinkError | null }>({
    device: null,
    frame: null,
    error: null,
  });
  useEffect(() => {
    if (!device) return;
    let count = 0;
    return device.watchScreen(
      (screen) => {
        if (screen.width !== PANEL_WIDTH || screen.height !== PANEL_HEIGHT) return;
        // drawnAt: when it arrived, a second at most after the terminal drew it.
        setState({ device, frame: { hash: `ble-${++count}`, drawnAt: new Date().toISOString(), bits: screen.bits }, error: null });
      },
      { onError: (error) => setState({ device, frame: null, error }) },
    );
  }, [device]);
  // Another device (or none) since: what was seen belongs to the one before.
  return state.device === device ? state : { frame: null, error: null };
}

export type BleTerminal = {
  /** Web Bluetooth is here; null until known. */
  supported: boolean | null;
  /** Connected to this terminal. */
  device: BleDevice | null;
  connecting: boolean;
  /** Opens the browser's chooser: call it from a click. */
  connect: () => void;
  disconnect: () => void;
};

/**
 * One given terminal over Bluetooth, for its console: the chooser, then a check that the device
 * picked is this terminal (its hardware ID), and its disconnection.
 */
export function useBleTerminal(
  hardwareId: string,
  on: {
    connected: (name: string) => void;
    /** Another terminal was picked: it is let go. */
    mismatch: (name: string) => void;
    failed: (error: LinkError) => void;
    disconnected: () => void;
  },
): BleTerminal {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [device, setDevice] = useState<BleDevice | null>(null);
  const [connecting, setConnecting] = useState(false);
  const handlers = useRef(on);
  useEffect(() => {
    handlers.current = on;
  });
  const current = useRef<BleDevice | null>(null);

  useEffect(() => {
    void isSupported().then(setSupported);
    return () => current.current?.disconnect();
  }, []);

  const connect = useCallback(() => {
    setConnecting(true);
    void (async () => {
      try {
        const picked = await BleDevice.request();
        if (!picked.ok) {
          if (picked.error.code !== "cancelled") handlers.current.failed(picked.error);
          return;
        }
        const found = picked.value;
        const info = await found.info();
        if (!info.ok) {
          found.disconnect();
          handlers.current.failed(info.error);
          return;
        }
        if (info.value.hardwareId.toUpperCase() !== hardwareId.toUpperCase()) {
          found.disconnect();
          handlers.current.mismatch(info.value.name);
          return;
        }
        found.onDisconnect(() => {
          if (current.current !== found) return;
          current.current = null;
          setDevice(null);
          handlers.current.disconnected();
        });
        current.current = found;
        setDevice(found);
        handlers.current.connected(info.value.name);
      } finally {
        setConnecting(false);
      }
    })();
  }, [hardwareId]);

  const disconnect = useCallback(() => current.current?.disconnect(), []);

  return { supported, device, connecting, connect, disconnect };
}
