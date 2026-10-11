"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eraser, FlipHorizontal2, ImageDown, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  setTerminalImage,
  terminalImageFromFile,
  terminalImageFromPhoto,
} from "@/app/org/[officeId]/admin/items/actions";

/** Side of the picture in panel pixels: what the terminal shows, pixel for pixel. */
const SIZE = 96;
/** Screen pixels per picture pixel in the editor: whole numbers keep every pixel sharp. */
const MIN_CELL = 2;
const MAX_CELL = 4;
/**
 * Height the dialog needs besides the grid, side by side (sm and up): its margin, padding, title,
 * hint, footer and gaps. Stacked (phones), the preview and the tools go under the grid too.
 */
const CHROME_SIDE_BY_SIDE = 250;
const CHROME_STACKED = 390;
/** Lines every 4 pixels: the grid of the 200 x 120 canvas the screens are laid out on. */
const GUIDE = 4;
const BRUSHES = [1, 2, 4];
const PAPER = "#ECEAE3";
const INK = "#1D1D1F";

type Pixels = boolean[];

function unpack(base64: string | null): Pixels {
  const pixels: Pixels = new Array(SIZE * SIZE).fill(false);
  if (!base64) return pixels;
  const bytes = Uint8Array.from(atob(base64), (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (bytes[i >> 3] & (0x80 >> (i & 7))) !== 0;
  return pixels;
}

function pack(pixels: Pixels): string {
  const bytes = new Uint8Array((SIZE * SIZE) / 8);
  pixels.forEach((ink, i) => {
    if (ink) bytes[i >> 3] |= 0x80 >> (i & 7);
  });
  return btoa(String.fromCodePoint(...bytes));
}

/** Draws the picture at `scale` pixels per pixel, with a grid when it is the editor. */
function Picture({
  pixels,
  scale,
  grid,
  ...canvasProps
}: { pixels: Pixels; scale: number; grid?: boolean } & React.ComponentProps<"canvas">) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = PAPER;
    context.fillRect(0, 0, SIZE * scale, SIZE * scale);
    context.fillStyle = INK;
    pixels.forEach((ink, i) => {
      if (ink) context.fillRect((i % SIZE) * scale, Math.floor(i / SIZE) * scale, scale, scale);
    });
    if (grid) {
      context.strokeStyle = "rgb(0 0 0 / 0.1)";
      for (let k = GUIDE; k < SIZE; k += GUIDE) {
        context.beginPath();
        context.moveTo(k * scale + 0.5, 0);
        context.lineTo(k * scale + 0.5, SIZE * scale);
        context.moveTo(0, k * scale + 0.5);
        context.lineTo(SIZE * scale, k * scale + 0.5);
        context.stroke();
      }
    }
  }, [pixels, scale, grid]);
  return <canvas ref={canvas} width={SIZE * scale} height={SIZE * scale} {...canvasProps} />;
}

/**
 * The editor's cell size: the largest whole number of screen pixels per picture pixel that fits
 * the width `room` gives and the window's height, so the dialog never needs scrolling. A ref
 * callback: the dialog's portal mounts its content a render after it opens.
 */
function useCell() {
  const [cell, setCell] = useState(MAX_CELL);
  const room = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const sideBySide = globalThis.matchMedia("(min-width: 640px)");
    const update = () => {
      const chrome = sideBySide.matches ? CHROME_SIDE_BY_SIDE : CHROME_STACKED;
      const side = Math.min(element.clientWidth, globalThis.innerHeight - chrome);
      setCell(Math.min(MAX_CELL, Math.max(MIN_CELL, Math.floor(side / SIZE))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    globalThis.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      globalThis.removeEventListener("resize", update);
    };
  }, []);
  return { room, cell };
}

/**
 * The item's picture on the badge terminal: 24 x 24 black and white. The
 * button shows it as the terminal will; the dialog edits it pixel by pixel,
 * imports a picture or starts from the item's photo.
 */
export function TerminalImageEditor({
  officeId,
  item,
}: Readonly<{
  officeId: string;
  item: { id: string; name: string; hasPhoto: boolean; terminalBits: string; custom: boolean };
}>) {
  const t = useTranslations("items.terminalImage");
  const [open, setOpen] = useState(false);
  const [pixels, setPixels] = useState(() => unpack(item.terminalBits));
  const [dither, setDither] = useState(false);
  const [brush, setBrush] = useState(2);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const painting = useRef<boolean | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { room, cell } = useCell();

  const paint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - box.left) / box.width) * SIZE);
    const y = Math.floor(((event.clientY - box.top) / box.height) * SIZE);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    // The first pixel decides: on an empty one the stroke draws, on an inked one it erases.
    painting.current ??= !pixels[y * SIZE + x];
    const ink = painting.current;
    // Every point since the last one, so a quick stroke has no gaps.
    const from = last.current ?? { x, y };
    const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y), 1);
    const touched = new Set<number>();
    for (let s = 0; s <= steps; s++) {
      const cx = Math.round(from.x + ((x - from.x) * s) / steps);
      const cy = Math.round(from.y + ((y - from.y) * s) / steps);
      const top = cy - Math.floor((brush - 1) / 2);
      const left = cx - Math.floor((brush - 1) / 2);
      for (let dy = 0; dy < brush; dy++) {
        for (let dx = 0; dx < brush; dx++) {
          const px = left + dx;
          const py = top + dy;
          if (px >= 0 && py >= 0 && px < SIZE && py < SIZE) touched.add(py * SIZE + px);
        }
      }
    }
    last.current = { x, y };
    setPixels((current) => current.map((p, k) => (touched.has(k) ? ink : p)));
  };

  const load = (result: { success: true; bits: string } | { success: false; error: string }) => {
    if (result.success) setPixels(unpack(result.bits));
    else toast.error(result.error);
  };

  const save = (bits: string | null) =>
    startTransition(async () => {
      const result = await setTerminalImage(officeId, item.id, bits);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(t("saved"));
      setOpen(false);
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPixels(unpack(item.terminalBits));
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          title={t("title")}
          aria-label={t("title")}
          className="shrink-0 overflow-hidden rounded-md border transition-colors hover:border-foreground/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Picture pixels={unpack(item.terminalBits)} scale={1} className="block size-12" />
        </button>
      </DialogTrigger>
      {/* Fits the window: the grid shrinks first (useCell); scrolling is the last resort. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("titleFor", { name: item.name })}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>

        {/* minmax(0, …): the grid's column is the room it gets, not the canvas's current width. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,1fr)_13rem]">
          <div ref={room} className="min-w-0">
            <Picture
              pixels={pixels}
              scale={cell}
              grid
              className="block touch-none rounded-md border [image-rendering:pixelated]"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                painting.current = null;
                last.current = null;
                paint(event);
              }}
              onPointerMove={(event) => {
                if (event.buttons) paint(event);
              }}
              onPointerUp={() => {
                painting.current = null;
                last.current = null;
              }}
            />
          </div>
          {/* Phones: the preview beside the tools, under the grid. Wider: one column beside the grid. */}
          <div className="flex gap-4 text-sm sm:flex-col sm:gap-3">
            <div className="shrink-0 space-y-1">
              <div className="text-xs text-muted-foreground">{t("onTerminal")}</div>
              <Picture pixels={pixels} scale={1} className="block rounded border" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-xs text-muted-foreground">{t("brush")}</span>
                {BRUSHES.map((size) => (
                  <Button
                    key={size}
                    size="xs"
                    variant={brush === size ? "default" : "outline"}
                    onClick={() => setBrush(size)}
                    aria-label={t("brushSize", { size })}
                  >
                    {size}
                  </Button>
                ))}
                <span className="ml-auto flex">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={t("invert")}
                    aria-label={t("invert")}
                    onClick={() => setPixels((current) => current.map((p) => !p))}
                  >
                    <FlipHorizontal2 />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={t("clear")}
                    aria-label={t("clear")}
                    onClick={() => setPixels((current) => current.map(() => false))}
                  >
                    <Eraser />
                  </Button>
                </span>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  const form = new FormData();
                  form.set("image", file);
                  form.set("mode", dither ? "dither" : "threshold");
                  startTransition(async () => load(await terminalImageFromFile(officeId, form)));
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                disabled={pending}
                onClick={() => fileInput.current?.click()}
              >
                <Upload /> <span className="truncate">{t("import")}</span>
              </Button>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={dither} onCheckedChange={setDither} /> {t("dither")}
              </label>
              {item.hasPhoto && (
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  disabled={pending}
                  onClick={() => startTransition(async () => load(await terminalImageFromPhoto(officeId, item.id)))}
                >
                  <ImageDown /> <span className="truncate">{t("fromPhoto")}</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {item.custom ? (
            <Button variant="ghost" disabled={pending} onClick={() => save(null)}>
              {t("reset")}
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={pending} onClick={() => save(pack(pixels))}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
