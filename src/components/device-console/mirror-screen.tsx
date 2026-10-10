"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Eye, LoaderCircle, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FrameCanvas } from "./frame-canvas";
import { PANEL_HEIGHT, PANEL_WIDTH, type Box, type MirrorFrame } from "./frame-bits";
import { ScreenControl } from "./screen-control";
import { ScreenPreview } from "./screen-preview";

/** The last frame the console drew, and how it changed from the one before. */
export type Mirror = {
  frame: MirrorFrame;
  change: { box: Box; percent: number; passes: 1 | 2; at: number } | null;
};

/**
 * What goes on the console's panel: the terminal's own frame, clickable for
 * taps, with the window its last refresh changed; before the first frame, a
 * waiting state, from which the site's preview can be shown instead.
 */
export function MirrorScreen({
  mirror,
  reachable,
  preview,
  previewUrl,
  onPreview,
  onTap,
}: {
  mirror: Mirror | null;
  reachable: boolean;
  preview: boolean;
  previewUrl: string;
  onPreview: () => void;
  onTap: (x: number, y: number) => void;
}) {
  const t = useTranslations("devices.console");
  if (!mirror) {
    if (preview) return <ScreenPreview url={previewUrl} placeholder={t("noScreen.previewLoading")} />;
    return (
      <div className="grid size-full place-items-center p-4 text-center sm:p-8">
        <div className="max-w-sm space-y-2 sm:space-y-3">
          {reachable ? (
            <LoaderCircle className="mx-auto size-6 animate-spin text-zinc-400" />
          ) : (
            <WifiOff className="mx-auto size-6 text-zinc-400" />
          )}
          <p className="text-sm font-medium text-zinc-800">{t("noScreen.title")}</p>
          <p className="hidden text-xs text-zinc-500 sm:block">{reachable ? t("noScreen.live") : t("noScreen.offline")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={onPreview}
            className="border-zinc-300 bg-white/60 text-zinc-800 hover:bg-white hover:text-zinc-900 dark:border-zinc-300 dark:bg-white/60 dark:text-zinc-800 dark:hover:bg-white"
          >
            <Eye /> {t("noScreen.preview")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <ScreenControl label={t("tapScreen")} onTap={onTap}>
      <FrameCanvas bits={mirror.frame.bits} className={cn("transition-opacity", !reachable && "opacity-60")} />
      {mirror.change && <ChangedWindow key={mirror.change.at} box={mirror.change.box} />}
    </ScreenControl>
  );
}

/** Outlines the window the last refresh redrew, then fades, like the studio's refresh log made visible. */
function ChangedWindow({ box }: { box: Box }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const current = element.current;
    if (!current) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.style.opacity = "0";
      return;
    }
    const animation = current.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], {
      duration: 1800,
      easing: "ease-out",
      fill: "forwards",
    });
    return () => animation.cancel();
  }, []);
  return (
    <div
      ref={element}
      aria-hidden
      className="pointer-events-none absolute bg-zinc-900/[0.05] outline-2 -outline-offset-2 outline-zinc-900/45 outline-dashed"
      style={{
        left: `${(box.x / PANEL_WIDTH) * 100}%`,
        top: `${(box.y / PANEL_HEIGHT) * 100}%`,
        width: `${(box.width / PANEL_WIDTH) * 100}%`,
        height: `${(box.height / PANEL_HEIGHT) * 100}%`,
      }}
    />
  );
}
