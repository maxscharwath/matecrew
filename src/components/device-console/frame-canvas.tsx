"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchFrame, paintFrame, PANEL_HEIGHT, PANEL_WIDTH } from "./frame-bits";

/**
 * Draws a 1-bit frame on an 800 × 480 canvas. A full refresh flashes black
 * and white like the panel (the virtual terminal's power-on); nothing else does.
 */
export function FrameCanvas({
  bits,
  refreshes = 0,
  full = false,
  className,
}: {
  bits: Uint8Array | null;
  refreshes?: number;
  full?: boolean;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context || !bits) return;
    paintFrame(context, bits);
    if (full && refreshes > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.animate([{ filter: "invert(1)" }, { filter: "none" }, { filter: "invert(1)" }, { filter: "none" }], {
        duration: 600,
        easing: "steps(1, end)",
      });
    }
  }, [bits, refreshes, full]);
  return <canvas ref={canvas} width={PANEL_WIDTH} height={PANEL_HEIGHT} className={cn("block size-full", className)} />;
}

/** A terminal's last uploaded screen, small: the device list's tile. Paper until it loads. */
export function FrameThumbnail({ url }: { url: string }) {
  const [bits, setBits] = useState<Uint8Array | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchFrame(url, controller.signal)
      .then((frame) => setBits(frame.bits))
      .catch(() => {
        // Nothing to show: the tile keeps its paper.
      });
    return () => controller.abort();
  }, [url]);
  return <FrameCanvas bits={bits} />;
}
