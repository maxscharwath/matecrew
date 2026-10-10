"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
const CELL = 4;
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("titleFor", { name: item.name })}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-5">
          <Picture
            pixels={pixels}
            scale={CELL}
            grid
            className="touch-none rounded-md border [image-rendering:pixelated]"
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
          <div className="flex min-w-40 flex-1 flex-col gap-3 text-sm">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">{t("onTerminal")}</div>
              <Picture pixels={pixels} scale={1} className="rounded border" />
            </div>
            <div className="flex items-center gap-1">
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
            <Button variant="outline" size="sm" className="justify-start" disabled={pending} onClick={() => fileInput.current?.click()}>
              <Upload /> {t("import")}
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
                <ImageDown /> {t("fromPhoto")}
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPixels((current) => current.map((p) => !p))}>
                <FlipHorizontal2 /> {t("invert")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPixels((current) => current.map(() => false))}>
                <Eraser /> {t("clear")}
              </Button>
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
