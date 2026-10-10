/**
 * 1-bit pictures for the terminal: item pictures, the catalogue fallback when an
 * item has none. Screen layout and stock charts are drawn in Rust. Bits are packed: row
 * after row, most significant bit first, 1 = ink.
 */
import sharp from "sharp";
import { CoffeeIcon } from "@matecrew/device-ui/icons/pixelarticons";
import { downloadFile } from "@/lib/storage";

export type Bitmap = { width: number; height: number; bits: Uint8Array };

/**
 * Side of an item picture in panel pixels. It takes 48 x 48 logical pixels of the
 * 400 x 240 canvas the screens are laid out on, which the panel shows 2
 * times bigger: a 96 x 96 picture keeps all its detail there.
 */
export const ITEM_IMAGE_SIZE = 96;
export const ITEM_IMAGE_BYTES = (ITEM_IMAGE_SIZE * ITEM_IMAGE_SIZE) / 8;
/** Pictures saved before they were 96 px: 24 x 24. */
const SMALL_IMAGE_SIZE = 24;
const SMALL_IMAGE_BYTES = (SMALL_IMAGE_SIZE * SMALL_IMAGE_SIZE) / 8;

export function blank(width: number, height: number): Bitmap {
  return {
    width,
    height,
    bits: new Uint8Array(Math.ceil((width * height) / 8)),
  };
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
export function dither(
  gray: Uint8Array,
  width: number,
  height: number,
): Bitmap {
  const out = blank(width, height);
  const level = Float32Array.from(gray);
  const spread: [number, number][] = [
    [1, 0],
    [2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const old = level[y * width + x];
      const ink = old < 128;
      if (ink) set(out, x, y);
      const error = (old - (ink ? 0 : 255)) / 8;
      for (const [dx, dy] of spread) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny < height)
          level[ny * width + nx] += error;
      }
    }
  }
  return out;
}

/** Each pixel of `b` as a `factor` x `factor` block. */
export function enlarge(b: Bitmap, factor: number): Bitmap {
  const out = blank(b.width * factor, b.height * factor);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++)
      if (get(b, Math.floor(x / factor), Math.floor(y / factor)))
        set(out, x, y);
  }
  return out;
}

/** `b` shrunk by `factor`: a block becomes ink when at least half of it is. */
export function shrink(b: Bitmap, factor: number): Bitmap {
  const out = blank(b.width / factor, b.height / factor);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      let ink = 0;
      for (let dy = 0; dy < factor; dy++)
        for (let dx = 0; dx < factor; dx++)
          if (get(b, x * factor + dx, y * factor + dy)) ink++;
      if (ink * 2 >= factor * factor) set(out, x, y);
    }
  }
  return out;
}

/** Licensed Pixelarticons fallback; product images supplied by the API take precedence. */
function fallbackProductImage(): Bitmap {
  const asset = CoffeeIcon({});
  if (asset.kind !== "image" || !("literal" in asset.value))
    throw new Error("Invalid product fallback");
  return enlarge(
    {
      width: asset.sourceWidth,
      height: asset.sourceHeight,
      bits: Uint8Array.from(asset.value.literal as number[]),
    },
    ITEM_IMAGE_SIZE / asset.sourceWidth,
  );
}

const cache = new Map<string, Promise<Bitmap | null>>();

async function load(imageKey: string): Promise<Buffer> {
  if (/^https?:\/\//.test(imageKey))
    return Buffer.from(await (await fetch(imageKey)).arrayBuffer());
  const { body } = await downloadFile(imageKey);
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(await new Response(body).arrayBuffer());
}

/**
 * Any picture as an item's 96 x 96: dithered for a photo, a plain threshold
 * for a drawing. Pixel art at 24, 48 or 96 px keeps its pixels.
 */
export async function pictureToBitmap(
  source: Buffer,
  mode: "dither" | "threshold",
): Promise<Bitmap> {
  const { width = 0, height = 0 } = await sharp(source).metadata();
  const pixelArt =
    width > 0 &&
    width === height &&
    width <= ITEM_IMAGE_SIZE &&
    ITEM_IMAGE_SIZE % width === 0;
  const { data } = await sharp(source)
    .flatten({ background: "#ffffff" })
    .resize(ITEM_IMAGE_SIZE, ITEM_IMAGE_SIZE, {
      fit: "contain",
      background: "#ffffff",
      kernel: pixelArt ? "nearest" : "lanczos3",
    })
    .greyscale()
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (mode === "dither") return dither(data, ITEM_IMAGE_SIZE, ITEM_IMAGE_SIZE);
  const out = blank(ITEM_IMAGE_SIZE, ITEM_IMAGE_SIZE);
  data.forEach((level, i) => {
    if (level < 128)
      set(out, i % ITEM_IMAGE_SIZE, Math.floor(i / ITEM_IMAGE_SIZE));
  });
  return out;
}

/**
 * The item's photo at 96 x 96, or null when it has none or it cannot be read.
 * A plain threshold: on product photos it keeps the outline and some of the
 * label, where dithering at this size is noise.
 */
export async function photoBitmap(
  imageKey: string | null,
): Promise<Bitmap | null> {
  if (!imageKey) return null;
  if (!cache.has(imageKey)) {
    cache.set(
      imageKey,
      load(imageKey)
        .then((source) => pictureToBitmap(source, "threshold"))
        .catch(() => null),
    );
  }
  return (await cache.get(imageKey)) ?? null;
}

/**
 * What the terminal shows for an item: its own black and white picture,
 * else its photo in black and white, else the catalogue fallback.
 */
/** The 24 x 24 sprites the Rust renderer draws on its logical canvas. */
export function smallImage(b: Bitmap): Bitmap {
  return shrink(b, ITEM_IMAGE_SIZE / SMALL_IMAGE_SIZE);
}

export async function itemImage(
  imageKey: string | null,
  terminalImage?: Uint8Array | null,
): Promise<Bitmap> {
  if (terminalImage?.length === ITEM_IMAGE_BYTES) {
    return {
      width: ITEM_IMAGE_SIZE,
      height: ITEM_IMAGE_SIZE,
      bits: Uint8Array.from(terminalImage),
    };
  }
  if (terminalImage?.length === SMALL_IMAGE_BYTES) {
    const small = {
      width: SMALL_IMAGE_SIZE,
      height: SMALL_IMAGE_SIZE,
      bits: Uint8Array.from(terminalImage),
    };
    return enlarge(small, ITEM_IMAGE_SIZE / SMALL_IMAGE_SIZE);
  }
  return (await photoBitmap(imageKey)) ?? fallbackProductImage();
}
