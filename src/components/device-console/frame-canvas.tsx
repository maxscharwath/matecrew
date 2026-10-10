"use client";
import { useEffect, useRef } from "react";

const PAPER = [236, 234, 227];
const INK = [29, 29, 31];

/** Draws the 1-bit frame. A full refresh flashes black and white like the panel; a partial one does not. */
export function FrameCanvas({ bits, refreshes, full }: { bits: Uint8Array | null; refreshes: number; full: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context || !bits) return;
    const image = context.createImageData(800, 480);
    for (let i = 0; i < 800 * 480; i++) {
      const [r, g, b] = bits[i >> 3] & (0x80 >> (i & 7)) ? INK : PAPER;
      image.data.set([r, g, b, 255], i * 4);
    }
    context.putImageData(image, 0, 0);
    if (full && refreshes > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.animate([{ filter: "invert(1)" }, { filter: "none" }, { filter: "invert(1)" }, { filter: "none" }], {
        duration: 600,
        easing: "steps(1, end)",
      });
    }
  }, [bits, refreshes, full]);
  return (
    <canvas
      ref={canvas}
      width={800}
      height={480}
      className="size-full [@media(min-resolution:2dppx)]:[image-rendering:pixelated]"
    />
  );
}

