"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BleDevice, isSupported, type DeviceInfo, type LinkError } from "@matecrew/device-ui/link";
import { deviceLogEntry, parseHeap, type LogEntry, type MemorySample } from "./device-log";
import { PANEL_HEIGHT, PANEL_WIDTH, type MirrorFrame } from "./frame-bits";

/** Lines kept from a terminal's log, and memory readings for the charts. */
const LOG_MAX = 500;
const MEMORY_MAX = 90;
/** How often a paired terminal's info (uptime, Wi-Fi, heap) is read again. */
const INFO_MS = 10_000;

export type BleSession = {
  /** What the terminal says about itself, read again every 10 s; null until the first read. */
  info: DeviceInfo | null;
  /** Why the last read of its info failed (a newer protocol, the link lost); null once one works. */
  infoError: LinkError | null;
  /** Its log, oldest first: every line the firmware writes, once paired. */
  logs: LogEntry[];
  /** Its free memory, from the `heap:` lines of the log, oldest first. */
  memory: MemorySample[];
  refresh: () => void;
  clearLogs: () => void;
};

type SessionState = {
  device: BleDevice | null;
  info: DeviceInfo | null;
  infoError: LinkError | null;
  logs: LogEntry[];
  memory: MemorySample[];
};

const fresh = (device: BleDevice | null): SessionState => ({ device, info: null, infoError: null, logs: [], memory: [] });

/**
 * A terminal connected over Bluetooth as a debugger sees it: its info, its log as it writes it
 * and its memory over time. Listening to the log pairs (the browser asks for the terminal's code).
 */
export function useBleSession(device: BleDevice | null): BleSession {
  const [state, setState] = useState<SessionState>(() => fresh(null));
  // What belongs to another device (or none) is dropped, not mixed in.
  const update = useCallback(
    (change: (current: SessionState) => SessionState) =>
      setState((current) => change(current.device === device ? current : fresh(device))),
    [device],
  );
  const read = useCallback(async () => {
    if (!device) return;
    const info = await device.info();
    update((current) =>
      info.ok ? { ...current, info: info.value, infoError: null } : { ...current, infoError: info.error },
    );
  }, [device, update]);

  useEffect(() => {
    if (!device) return;
    let count = 0;
    void read();
    const timer = setInterval(() => void read(), INFO_MS);
    const stop = device.onEvent((event) => {
      const at = Date.now();
      const entry = deviceLogEntry(event, `ble-${++count}`, at);
      const sample = event.t === "log" ? parseHeap(event.msg, at) : null;
      if (!entry && !sample) return;
      update((current) => ({
        ...current,
        logs: entry ? [...current.logs, entry].slice(-LOG_MAX) : current.logs,
        memory: sample ? [...current.memory, sample].slice(-MEMORY_MAX) : current.memory,
      }));
    });
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [device, read, update]);

  const clearLogs = useCallback(() => update((current) => ({ ...current, logs: [] })), [update]);
  const shown = state.device === device ? state : fresh(device);
  return {
    info: shown.info,
    infoError: shown.infoError,
    logs: shown.logs,
    memory: shown.memory,
    refresh: () => void read(),
    clearLogs,
  };
}

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
