"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONSOLE_HEADER,
  FRAME_BYTES,
  PANEL_HEIGHT,
  SUBPROTOCOL,
  applyPatch,
  parse,
  readPatch,
  type Command,
  type CommandEntry,
  type TerminalStatus,
  type ToConsole,
  type Tone,
} from "../../../realtime/src/protocol";
import type { LogEntry, MemorySample } from "./device-log";
import { deviceLogEntry, parseHeap } from "./device-log";
import type { MirrorFrame } from "./frame-bits";

/** Where the console opens its socket, with a one-time ticket (`consoleSocket`). */
export type RelaySocket = { url: string; ticket: string };

export type RelayEvents = {
  online(online: boolean, since: number | null): void;
  status(status: TerminalStatus, at: number): void;
  /** Every command the relay lists, at once when the socket opens, one by one after. */
  commands(entries: CommandEntry[]): void;
  frame(frame: MirrorFrame): void;
  log(entry: LogEntry, memory: MemorySample | null): void;
  /** The terminal beeped these tones. */
  beep(tones: Tone[]): void;
};

/** Reconnections back off up to this. */
const MAX_RETRY_MS = 10_000;

/**
 * The console's socket to the terminal's relay (realtime/): its presence, status, log, commands
 * and screen, pushed as they happen; commands go out on it. Reconnects with a fresh ticket
 * (`renew`), backing off. While the page is hidden or `screen` is false (the screen comes over
 * Bluetooth), the relay is told, and the terminal stops sending its screen.
 */
export function useRelay(
  initial: RelaySocket | null,
  renew: () => Promise<RelaySocket | null>,
  events: RelayEvents,
  screen: boolean,
): { connected: boolean; send: (command: Command) => boolean } {
  const [connected, setConnected] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const handlers = useRef(events);
  const renewer = useRef(renew);
  const [visible, setVisible] = useState(true);
  const watching = screen && visible;
  const wantScreen = useRef(watching);
  useEffect(() => {
    handlers.current = events;
    renewer.current = renew;
    wantScreen.current = watching;
  });

  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (!initial) return;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: RelaySocket | null = initial;
    let frame: Uint8Array | null = null;
    let counter = 0;

    const retry = () => {
      if (stopped) return;
      const delay = Math.min(MAX_RETRY_MS, 500 * 2 ** attempt);
      attempt += 1;
      timer = setTimeout(() => void open(), delay);
    };

    const onText = (text: string) => {
      const message = parse<ToConsole>(text, ["online", "status", "log", "beep", "commands", "command"]);
      if (!message) return;
      const on = handlers.current;
      switch (message.t) {
        case "online":
          on.online(message.online, message.since);
          break;
        case "status":
          on.status(message.status, message.at);
          break;
        case "commands":
          on.commands(message.entries);
          break;
        case "command":
          on.commands([message.entry]);
          break;
        case "beep":
          on.beep(message.tones);
          break;
        case "log": {
          // The same line as over Bluetooth.
          const { level, target, msg, at } = message;
          const entry = deviceLogEntry({ t: "log", level, target, msg }, `relay-${++counter}`, at);
          if (entry) on.log(entry, parseHeap(msg, at));
          break;
        }
      }
    };

    const onBinary = (data: ArrayBuffer) => {
      const patch = readPatch(data, CONSOLE_HEADER);
      if (!patch) return;
      // A patch needs the screen it applies to: the relay sends the whole one first.
      if (!frame && !(patch.y === 0 && patch.rows === PANEL_HEIGHT)) return;
      const next = frame ? frame.slice() : new Uint8Array(FRAME_BYTES);
      applyPatch(next, patch);
      frame = next;
      const drawnAt = patch.drawnAt ?? Date.now();
      handlers.current.frame({ hash: `r${drawnAt}-${++counter}`, drawnAt: new Date(drawnAt).toISOString(), bits: next });
    };

    const open = async () => {
      const target = pending ?? (await renewer.current().catch(() => null));
      pending = null;
      if (stopped) return;
      if (!target) return retry();
      const ws = new WebSocket(target.url, [SUBPROTOCOL, target.ticket]);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        if (!wantScreen.current) ws.send(JSON.stringify({ t: "watch", screen: false }));
      };
      ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (typeof event.data === "string") onText(event.data);
        else onBinary(event.data);
      };
      ws.onclose = () => {
        if (socket.current === ws) socket.current = null;
        setConnected(false);
        // The screen comes whole again with the next socket.
        frame = null;
        retry();
      };
    };

    void open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket.current?.close(1000, "left");
      socket.current = null;
    };
  }, [initial]);

  // Tells the relay whether to send the screen.
  useEffect(() => {
    const ws = socket.current;
    if (connected && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "watch", screen: watching }));
  }, [watching, connected]);

  const send = useCallback((command: Command) => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ t: "command", command }));
    return true;
  }, []);

  return { connected, send };
}
