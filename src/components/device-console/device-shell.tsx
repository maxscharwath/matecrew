"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Nfc } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { fitPanel, PANEL_WIDTH, PAPER_HEX } from "./frame-bits";

export type Side = "left" | "right";
export type KeyLevel = (side: Side, high: boolean, source: string) => void;

/**
 * ← and → press the keys, B opens the badge picker, S syncs. Off while
 * `paused` (the badge picker is open) or while typing in a field.
 */
export function useDeviceShortcuts(
  handlers: {
    key: (side: Side) => void;
    keyLevel?: KeyLevel;
    badge: () => void;
    sync: () => void;
  },
  paused: boolean,
) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || paused) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]"))
        return;
      const action = {
        ArrowLeft: () => (handlers.keyLevel ? handlers.keyLevel("left", true, "keyboard") : handlers.key("left")),
        ArrowRight: () => (handlers.keyLevel ? handlers.keyLevel("right", true, "keyboard") : handlers.key("right")),
        b: handlers.badge,
        s: handlers.sync,
      }[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight")
        handlers.keyLevel?.(event.key === "ArrowLeft" ? "left" : "right", false, "keyboard");
    };
    const release = () => {
      handlers.keyLevel?.("left", false, "keyboard");
      handlers.keyLevel?.("right", false, "keyboard");
    };
    globalThis.addEventListener("keyup", onKeyUp);
    globalThis.addEventListener("blur", release);
    return () => {
      release();
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("keyup", onKeyUp);
      globalThis.removeEventListener("blur", release);
    };
  }, [handlers, paused]);
}

/** Key centres along the panel's 800 px, from the enclosure model in device/hardware. */
const KEY_LEFT = `${(130 / PANEL_WIDTH) * 100}%`;
const KEY_RIGHT = `${(670 / PANEL_WIDTH) * 100}%`;

// Layout effects only run in the browser; on the server the panel keeps its CSS fallback.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Sizes the panel to the room its column gives it, in whole device pixels
 * per panel pixel when it can (see `fitPanel`), and keeps it so on resize and zoom.
 */
function usePanelFit() {
  const room = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ width: number; pixelated: boolean } | null>(null);
  useBrowserLayoutEffect(() => {
    const update = () => {
      if (!room.current || !shell.current || !panel.current) return;
      // The case's padding and borders around the panel's pixels, whatever width they have now.
      const sides = (element: HTMLElement, ...properties: string[]) => {
        const style = getComputedStyle(element);
        return properties.reduce((sum, property) => sum + (Number.parseFloat(style.getPropertyValue(property)) || 0), 0);
      };
      const chrome =
        sides(shell.current, "padding-left", "padding-right", "border-left-width", "border-right-width") +
        sides(panel.current, "border-left-width", "border-right-width");
      const next = fitPanel(Math.max(0, room.current.clientWidth - chrome), globalThis.devicePixelRatio || 1);
      setFit((current) =>
        current && Math.abs(current.width - next.width) < 0.01 && current.pixelated === next.pixelated ? current : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (room.current) observer.observe(room.current);
    // Zoom and moving to another screen change the pixel ratio without resizing anything.
    globalThis.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      globalThis.removeEventListener("resize", update);
    };
  }, []);
  return { room, shell, panel, fit };
}

/**
 * The terminal as it sits on the desk: the e-ink panel, the two touch keys
 * under it and the NFC zone between them, labelled with their parts like the
 * SDK studio. The console and the virtual terminal both draw it; `screen` is
 * what the panel shows, `indicator` sits on the case above it (refresh, state).
 */
export function DeviceShell({
  screen,
  onKey,
  onKeyLevel,
  pressed,
  badge,
  indicator,
}: {
  screen: ReactNode;
  onKey: (side: Side) => void;
  onKeyLevel?: KeyLevel;
  /** The key to light up, for feedback on a press from the keyboard. */
  pressed: Side | readonly Side[] | null;
  badge: ReactNode;
  indicator?: ReactNode;
}) {
  const t = useTranslations("devices.console");
  const { room, shell, panel, fit } = usePanelFit();
  const isPressed = (side: Side) => pressed === side || (Array.isArray(pressed) && pressed.includes(side));
  return (
    <div ref={room} className="w-full">
      <div
        ref={shell}
        className={cn(
          "relative mx-auto max-w-full rounded-[1.75rem] border border-zinc-300 bg-linear-to-b from-zinc-50 to-zinc-200 px-3 pt-7 pb-1 shadow-[0_24px_48px_-24px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.8)] sm:px-5 sm:pt-8 dark:border-zinc-700 dark:from-zinc-800 dark:to-zinc-900 dark:shadow-[0_24px_48px_-24px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(255_255_255/0.06)]",
          // Until the panel is measured (server render), fill the column like an 800 px panel would.
          fit ? "w-fit" : "w-full max-w-[850px]",
        )}
      >
        {indicator && (
          <div className="absolute top-1.5 right-4 flex h-5 items-center gap-1.5 sm:top-2 sm:right-6">{indicator}</div>
        )}
        <div
          ref={panel}
          style={{ width: fit ? `${fit.width}px` : "calc(100% - 8px)", backgroundColor: PAPER_HEX }}
          className={cn(
            "relative box-content aspect-[800/480] max-w-full overflow-hidden rounded-[0.35rem] border-4 border-zinc-900 shadow-[inset_0_2px_8px_rgb(0_0_0/0.25)] dark:border-black",
            fit?.pixelated && "[&_canvas]:[image-rendering:pixelated]",
          )}
        >
          {screen}
        </div>
        <div className="relative h-24 sm:h-28">
          <TouchKey
            side="left"
            label={t("leftKey")}
            meta="TTP223 · GPIO 5"
            hint="←"
            left={KEY_LEFT}
            pressed={isPressed("left")}
            onPress={onKey}
            onLevel={onKeyLevel}
          />
          <div className="absolute top-3 left-1/2 -translate-x-1/2">{badge}</div>
          <TouchKey
            side="right"
            label={t("rightKey")}
            meta="TTP223 · GPIO 8"
            hint="→"
            left={KEY_RIGHT}
            pressed={isPressed("right")}
            onPress={onKey}
            onLevel={onKeyLevel}
          />
        </div>
      </div>
    </div>
  );
}

function TouchKey({
  side,
  label,
  meta,
  hint,
  left,
  pressed,
  onPress,
  onLevel,
}: {
  side: Side;
  label: string;
  meta: string;
  hint: string;
  left: string;
  pressed: boolean;
  onPress: (side: Side) => void;
  onLevel?: KeyLevel;
}) {
  const [held, setHeld] = useState(false);
  const level = (high: boolean, source: string) => {
    setHeld(high);
    onLevel?.(side, high, source);
  };
  pressed ||= held;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        if (!onLevel || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        level(true, `pointer:${event.pointerId}`);
      }}
      onPointerUp={(event) => level(false, `pointer:${event.pointerId}`)}
      onPointerCancel={(event) => level(false, `pointer:${event.pointerId}`)}
      onLostPointerCapture={(event) => level(false, `pointer:${event.pointerId}`)}
      onKeyDown={(event) => {
        if (onLevel && [" ", "Enter"].includes(event.key)) {
          event.preventDefault();
          if (!event.repeat) level(true, "focused-key");
        }
      }}
      onKeyUp={(event) => {
        if ([" ", "Enter"].includes(event.key)) {
          if (onLevel) event.preventDefault();
          level(false, "focused-key");
        }
      }}
      onBlur={() => level(false, "focused-key")}
      onClick={(event) => {
        if (!onLevel || event.detail === 0) onPress(side);
      }}
      style={{ left }}
      className="group absolute top-3 flex touch-none -translate-x-1/2 flex-col items-center gap-1 outline-none"
    >
      <span
        className={cn(
          "relative grid size-11 place-items-center rounded-full border border-zinc-300 bg-linear-to-b from-white to-zinc-100 shadow-[0_2px_4px_rgb(0_0_0/0.12),inset_0_-2px_0_rgb(0_0_0/0.06)] transition-transform duration-75 group-active:translate-y-px group-active:scale-95 group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50 sm:size-12 dark:border-zinc-600 dark:from-zinc-700 dark:to-zinc-800",
          pressed && "translate-y-px scale-95",
        )}
      >
        <span
          className={cn(
            "size-2.5 rounded-full bg-zinc-300 transition-colors dark:bg-zinc-500",
            pressed && "bg-emerald-500 dark:bg-emerald-400",
          )}
        />
        {pressed && <span className="absolute inset-0 animate-ping rounded-full border-2 border-emerald-500/60" />}
      </span>
      <span className="flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-zinc-700 dark:text-zinc-300">
        <span className="hidden sm:inline">{label}</span>
        <kbd className="rounded border border-zinc-300 bg-white/70 px-1 font-mono text-[10px] leading-4 text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-400">
          {hint}
        </kbd>
      </span>
      <span className="hidden font-mono text-[10px] whitespace-nowrap text-zinc-500 sm:block">{meta}</span>
    </button>
  );
}

export type BadgeOption = { uid: string; name: string | null };

/** 7-byte UID like the office's DESFire badges; 04 is NXP's manufacturer code. */
export function randomUid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `04${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** What a person typed, as an UID, when it only has hex digits and separators. */
export function asUid(input: string): string | null {
  if (!/^[0-9a-f:\s-]+$/i.test(input.trim())) return null;
  const uid = input.toUpperCase().replaceAll(/[^0-9A-F]/g, "");
  return uid.length >= 8 && uid.length <= 20 && uid.length % 2 === 0 ? uid : null;
}

/** The NFC zone: pick a badge from the office, an unknown one, or type an UID. */
export function BadgeZone({
  badges,
  open,
  onOpenChange,
  onBadge,
  flashing,
}: {
  badges: BadgeOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBadge: (uid: string) => void;
  flashing: boolean;
}) {
  const t = useTranslations("devices.console");
  const [query, setQuery] = useState("");
  const typed = asUid(query);
  const pick = (uid: string) => {
    onOpenChange(false);
    setQuery("");
    onBadge(uid);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={t("badge")} className="group flex flex-col items-center gap-1 outline-none">
          <span
            className={cn(
              "grid h-11 w-16 place-items-center rounded-lg border border-zinc-300 bg-[repeating-radial-gradient(circle,#e4e4e7_0_3px,#d4d4d8_3px_5px)] text-zinc-500 shadow-[0_2px_4px_rgb(0_0_0/0.12)] transition group-hover:text-zinc-700 group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50 sm:h-12 dark:border-zinc-600 dark:bg-[repeating-radial-gradient(circle,#3f3f46_0_3px,#35353b_3px_5px)] dark:text-zinc-400 dark:group-hover:text-zinc-200",
              flashing && "translate-y-px text-emerald-600 ring-[3px] ring-emerald-500/50 dark:text-emerald-400",
            )}
          >
            <Nfc className="size-5" />
          </span>
          <span className="flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-zinc-700 dark:text-zinc-300">
            <span className="hidden sm:inline">{t("badge")}</span>
            <kbd className="rounded border border-zinc-300 bg-white/70 px-1 font-mono text-[10px] leading-4 text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-400">
              B
            </kbd>
          </span>
          <span className="hidden font-mono text-[10px] whitespace-nowrap text-zinc-500 sm:block">PN532 · I2C 0x24</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" side="top">
        <Command>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("badgeSearch")} />
          <CommandList>
            {!typed && <CommandEmpty>{t("noBadge")}</CommandEmpty>}
            {typed && (
              <CommandGroup forceMount>
                <CommandItem forceMount value={`uid ${typed}`} onSelect={() => pick(typed)}>
                  <Nfc /> {t("customUid", { uid: typed })}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              <CommandItem value="__unknown" keywords={[t("newBadge")]} onSelect={() => pick(randomUid())}>
                <Nfc />
                <span>{t("newBadge")}</span>
                <span className="ml-auto text-xs text-muted-foreground">{t("newBadgeHint")}</span>
              </CommandItem>
            </CommandGroup>
            {badges.length > 0 && <CommandSeparator />}
            {badges.length > 0 && (
              <CommandGroup heading={t("badgesKnown")}>
                {badges.map((badge) => (
                  <CommandItem
                    key={badge.uid}
                    value={badge.uid}
                    keywords={[badge.name ?? t("unassigned")]}
                    onSelect={() => pick(badge.uid)}
                  >
                    <span className={cn(!badge.name && "text-muted-foreground")}>{badge.name ?? t("unassigned")}</span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">{badge.uid}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
