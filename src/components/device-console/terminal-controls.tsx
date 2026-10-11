"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Keyboard } from "lucide-react";
import { fromRow, type CommandRow, type ConsoleCommand } from "@/lib/device/console-commands";
import { BadgeZone, DeviceShell, useDeviceShortcuts, useKeyChord, type BadgeOption, type Side } from "./device-shell";
import type { ConsoleKind, LogEntry } from "./device-log";
import { PANEL_WIDTH } from "./frame-bits";

/**
 * What both consoles share around the way each one sends: the one of a linked terminal (Wi-Fi
 * through the relay or the site, Bluetooth nearby) and the Bluetooth page. The keys and what they
 * light, both keys, the badge reader, the shortcuts, the panel with its hint, the commands' labels
 * and the console's own log lines.
 */

/** How long a key or the badge zone stays lit after a press. */
const FLASH_MS = 700;
/** Lines the console keeps of its own. */
const MAX_EVENTS = 400;
/** Remote taps are 200 × 120; the log shows them in panel pixels. */
const TAP_SCALE = PANEL_WIDTH / 200;

/** Keys, badges and taps are input; the rest acts on the terminal itself. */
export function commandKind(command: ConsoleCommand): ConsoleKind {
  return ["key", "longKey", "both", "badge", "tap"].includes(command.kind) ? "input" : "system";
}

/** What a command is called in the log, as sent and as the site stores it. */
export function useCommandLabels() {
  const t = useTranslations("devices.console");
  const describe = useCallback(
    (command: ConsoleCommand): string => {
      switch (command.kind) {
        case "key":
          return command.side === "right" ? t("kind.keyRight") : t("kind.keyLeft");
        case "longKey":
          return command.side === "right" ? t("kind.longKeyRight") : t("kind.longKeyLeft");
        case "both":
          return t("kind.both");
        case "badge":
          return t("kind.badge", { uid: command.uid });
        case "tap":
          return t("kind.tap", { x: command.x * TAP_SCALE, y: command.y * TAP_SCALE });
        case "sync":
          if (command.app) return t("kind.app", { app: command.app === "mate" ? "maté" : "Showcase" });
          return t("kind.sync");
        case "restart":
          return t("kind.restart");
        case "forgetWifi":
          return t("kind.forgetWifi");
      }
    },
    [t],
  );
  const describeRow = useCallback(
    (row: CommandRow): string => {
      const command = fromRow(row);
      return command ? describe(command) : row.kind;
    },
    [describe],
  );
  return { describe, describeRow };
}

/** The console's own lines (link, screen, errors), and when the log was last cleared. */
export function useConsoleLog(first?: LogEntry) {
  const [events, setEvents] = useState<LogEntry[]>(() => (first ? [first] : []));
  const [clearedAt, setClearedAt] = useState(0);
  const count = useRef(0);
  const addEvent = useCallback((kind: ConsoleKind, text: string) => {
    const entry: LogEntry = {
      id: `e${++count.current}`,
      at: Date.now(),
      source: "console",
      level: kind === "error" ? "E" : "I",
      tag: kind,
      text,
    };
    setEvents((current) => [...current, entry].slice(-MAX_EVENTS));
  }, []);
  const clear = useCallback(() => setClearedAt(Date.now()), []);
  return { events, addEvent, clearedAt, clear };
}

/**
 * The terminal's keys and reader, driven from a console that sends with `send`: a press lights its
 * key or the badge zone; both keys as on the terminal (hold one, press the other); ← → B S on the
 * keyboard unless `paused` (a picker or another tab is open).
 */
export function useTerminalControls(send: (command: ConsoleCommand) => void, paused: boolean) {
  const [pressed, setPressed] = useState<Side | "badge" | null>(null);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const flash = useRef<ReturnType<typeof setTimeout>>(undefined);
  const press = useCallback(
    (command: ConsoleCommand) => {
      if (command.kind === "key" || command.kind === "longKey" || command.kind === "badge") {
        setPressed(command.kind === "badge" ? "badge" : command.side);
        clearTimeout(flash.current);
        flash.current = setTimeout(() => setPressed(null), FLASH_MS);
      }
      send(command);
    },
    [send],
  );
  const chord = useKeyChord(press);
  const shortcuts = useMemo(
    () => ({
      key: (side: Side) => press({ kind: "key", side }),
      keyLevel: chord.keyLevel,
      badge: () => setBadgeOpen(true),
      sync: () => press({ kind: "sync" }),
    }),
    [press, chord.keyLevel],
  );
  useDeviceShortcuts(shortcuts, badgeOpen || paused);
  const single = pressed === "left" || pressed === "right" ? pressed : null;
  const lit: Side | readonly Side[] | null = chord.held.length > 0 ? chord.held : single;
  return { press, pressed, lit, keyLevel: chord.keyLevel, badgeOpen, setBadgeOpen };
}

/** The terminal on the desk, driven by `controls`, with the shortcuts' hint under it. */
export function TerminalPanel({
  controls,
  badges,
  screen,
  indicator,
}: Readonly<{
  controls: ReturnType<typeof useTerminalControls>;
  badges: BadgeOption[];
  screen: ReactNode;
  indicator?: ReactNode;
}>) {
  const t = useTranslations("devices.console");
  return (
    <div className="space-y-3">
      <DeviceShell
        pressed={controls.lit}
        onKey={(side) => controls.press({ kind: "key", side })}
        onKeyLevel={controls.keyLevel}
        indicator={indicator}
        screen={screen}
        badge={
          <BadgeZone
            badges={badges}
            open={controls.badgeOpen}
            onOpenChange={controls.setBadgeOpen}
            flashing={controls.pressed === "badge"}
            onBadge={(uid) => controls.press({ kind: "badge", uid })}
          />
        }
      />
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Keyboard className="hidden size-3.5 shrink-0 sm:block" /> {t("shortcuts")} {t("tapHint")}
      </p>
    </div>
  );
}
