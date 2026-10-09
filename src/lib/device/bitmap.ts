/**
 * 1-bit pictures for the terminal: product photos dithered to pixel art, the
 * default can when an item has none, and the stock chart. Bits are packed
 * like the panel: row after row, most significant bit first, 1 = ink.
 */
import sharp from "sharp";
import { downloadFile } from "@/lib/storage";

export type Bitmap = { width: number; height: number; bits: Uint8Array };

/** Side of an item picture, in the 200 x 120 canvas the screens are drawn on. */
export const ITEM_IMAGE_SIZE = 24;

export function blank(width: number, height: number): Bitmap {
  return { width, height, bits: new Uint8Array(Math.ceil((width * height) / 8)) };
}

export function set(b: Bitmap, x: number, y: number, ink = true): void {
  if (x < 0 || y < 0 || x >= b.width || y >= b.height) return;
  const i = y * b.width + x;
  if (ink) b.bits[i >> 3] |= 0x80 >> (i & 7);
  else b.bits[i >> 3] &= ~(0x80 >> (i & 7));
}

export function get(b: Bitmap, x: number, y: number): boolean {
  const i = y * b.width + x;
  return (b.bits[i >> 3] & (0x80 >> (i & 7))) !== 0;
}

/** Atkinson dithering: the Macintosh look, which keeps a small photo readable. */
export function dither(gray: Uint8Array, width: number, height: number): Bitmap {
  const out = blank(width, height);
  const level = Float32Array.from(gray);
  const spread: [number, number][] = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const old = level[y * width + x];
      const ink = old < 128;
      if (ink) set(out, x, y);
      const error = (old - (ink ? 0 : 255)) / 8;
      for (const [dx, dy] of spread) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) level[ny * width + nx] += error;
      }
    }
  }
  return out;
}

export async function toPngDataUrl(b: Bitmap): Promise<string> {
  const gray = Buffer.alloc(b.width * b.height);
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) gray[y * b.width + x] = get(b, x, y) ? 0 : 255;
  }
  const png = await sharp(gray, { raw: { width: b.width, height: b.height, channels: 1 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** The default picture: a can with a dithered label. */
export function canIcon(): Bitmap {
  const b = blank(ITEM_IMAGE_SIZE, ITEM_IMAGE_SIZE);
  const line = (x0: number, x1: number, y: number) => {
    for (let x = x0; x <= x1; x++) set(b, x, y);
  };
  line(9, 14, 1); // tab
  line(8, 15, 2);
  line(7, 16, 3); // rim
  for (let y = 4; y <= 21; y++) {
    set(b, 6, y);
    set(b, 17, y);
  }
  line(7, 16, 22);
  line(7, 16, 5); // top seam
  line(7, 16, 19); // bottom seam
  for (let y = 8; y <= 16; y++) {
    for (let x = 7; x <= 16; x++) if ((x + y) % 2 === 0 && x !== 9) set(b, x, y);
  }
  line(7, 16, 8);
  line(7, 16, 16);
  return b;
}

const cache = new Map<string, Promise<Bitmap | null>>();

async function load(imageKey: string): Promise<Buffer> {
  if (/^https?:\/\//.test(imageKey)) return Buffer.from(await (await fetch(imageKey)).arrayBuffer());
  const { body } = await downloadFile(imageKey);
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(await new Response(body).arrayBuffer());
}

/** An item's picture as 1-bit pixel art, or the default can. Kept in memory per image. */
export async function itemImage(imageKey: string | null): Promise<Bitmap> {
  if (!imageKey) return canIcon();
  if (!cache.has(imageKey)) {
    cache.set(
      imageKey,
      load(imageKey)
        .then(async (source) => {
          const { data } = await sharp(source)
            .flatten({ background: "#ffffff" })
            .resize(ITEM_IMAGE_SIZE, ITEM_IMAGE_SIZE, { fit: "contain", background: "#ffffff" })
            .greyscale()
            .normalise()
            .raw()
            .toBuffer({ resolveWithObject: true });
          return dither(data, ITEM_IMAGE_SIZE, ITEM_IMAGE_SIZE);
        })
        .catch(() => null),
    );
  }
  return (await cache.get(imageKey)) ?? canIcon();
}

/** Line styles that stay apart in black and white: solid, dashed, dotted. */
const PATTERNS = [() => true, (i: number) => i % 5 < 3, (i: number) => i % 2 === 0];

export function patternSample(index: number, width: number): Bitmap {
  const b = blank(width, 2);
  for (let x = 0; x < width; x++) {
    if (!PATTERNS[index % PATTERNS.length](x)) continue;
    set(b, x, 0);
    set(b, x, 1);
  }
  return b;
}

/**
 * Stock over the last days as step lines, one style per item, under a dotted
 * line at the low-stock threshold. `max` is the top of the scale.
 */
export function stockChart(series: number[][], max: number, threshold: number | null, width: number, height: number): Bitmap {
  const b = blank(width, height);
  const top = 1;
  const bottom = height - 2;
  const y = (v: number) => Math.round(bottom - (Math.max(0, v) / Math.max(1, max)) * (bottom - top));
  for (let x = 0; x < width; x++) set(b, x, height - 1); // axis
  if (threshold !== null && threshold <= max) {
    for (let x = 0; x < width; x += 3) set(b, x, y(threshold));
  }
  series.forEach((values, s) => {
    const pattern = PATTERNS[s % PATTERNS.length];
    const step = (width - 1) / Math.max(1, values.length - 1);
    let walked = 0;
    const plot = (px: number, py: number) => {
      if (pattern(walked++)) {
        set(b, px, py);
        set(b, px, py - 1);
      }
    };
    for (let i = 0; i < values.length; i++) {
      const x0 = Math.round(i * step);
      const x1 = i + 1 < values.length ? Math.round((i + 1) * step) : width - 1;
      const level = y(values[i]);
      for (let x = x0; x <= x1; x++) plot(x, level);
      if (i + 1 < values.length) {
        const next = y(values[i + 1]);
        for (let py = Math.min(level, next) + 1; py < Math.max(level, next); py++) plot(x1, py);
      }
    }
  });
  return b;
}
