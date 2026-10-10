"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, CircuitBoard } from "lucide-react";
import { cn } from "@/lib/utils";
import { RailCard } from "./workbench";

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
 * The board and its wiring, folded by default: the pads light up while the console drives them
 * (a key, a badge, a refresh of the mirror).
 */
export function BoardCard({ active }: Readonly<{ active: ReadonlySet<number> }>) {
  const t = useTranslations("devices.console.board");
  const [open, setOpen] = useState(false);
  return (
    <RailCard
      icon={<CircuitBoard />}
      title="XIAO ESP32-S3"
      description={t("subtitle")}
      action={
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t("hide") : t("show")}
          onClick={() => setOpen((current) => !current)}
          className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      }
    >
      {open && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="w-4 py-1 font-normal">
                <span className="sr-only">{t("activity")}</span>
              </th>
              <th className="py-1 font-normal">{t("pad")}</th>
              <th className="py-1 font-normal">GPIO</th>
              <th className="py-1 font-normal">{t("function")}</th>
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
                  <td className={cn("py-1 text-muted-foreground", on && "text-foreground")}>{t(`pins.${pin.role}`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </RailCard>
  );
}
