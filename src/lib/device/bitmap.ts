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
 * Side of an item picture in panel pixels, as the terminal draws it; where a screen has less
 * room, the terminal halves it.
 */
export const ITEM_IMAGE_SIZE = 96;
export const ITEM_IMAGE_BYTES = (ITEM_IMAGE_SIZE * ITEM_IMAGE_SIZE) / 8;

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

/** Where Atkinson dithering passes a pixel's error: an eighth to each of these neighbours. */
const ATKINSON: readonly (readonly [number, number])[] = [
  [1, 0],
  [2, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
  [0, 2],
];

/** Adds `error` to the neighbours of (x, y) that are still to come and on the picture. */
function spread(level: Float32Array, width: number, height: number, x: number, y: number, error: number): void {
  for (const [dx, dy] of ATKINSON) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < width && ny < height) level[ny * width + nx] += error;
  }
}

/** Atkinson dithering: the Macintosh look, which keeps a small photo readable. */
export function dither(
  gray: Uint8Array,
  width: number,
  height: number,
): Bitmap {
  const out = blank(width, height);
  const level = Float32Array.from(gray);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const old = level[y * width + x];
      const ink = old < 128;
      if (ink) set(out, x, y);
      spread(level, width, height, x, y, (old - (ink ? 0 : 255)) / 8);
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
 * The picture followed by its opacity plane, the three colours the terminal draws: ink black,
 * paper white where it belongs to the object, transparent around it. The surroundings are the
 * paper reachable from the edges without crossing ink, so the white body of a can stays white
 * on the grey disc behind it and the space around the can shows the disc.
 */
export function withOpacity(b: Bitmap): Uint8Array {
  const { width, height, bits } = b;
  const ink = (i: number) => (bits[i >> 3] & (0x80 >> (i & 7))) !== 0;
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  const reach = (x: number, y: number) => {
    const i = y * width + x;
    if (!outside[i] && !ink(i)) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    reach(x, 0);
    reach(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    reach(0, y);
    reach(width - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) reach(x - 1, y);
    if (x < width - 1) reach(x + 1, y);
    if (y > 0) reach(x, y - 1);
    if (y < height - 1) reach(x, y + 1);
  }
  const planes = new Uint8Array(bits.length * 2);
  planes.set(bits);
  for (let i = 0; i < width * height; i++) {
    if (!outside[i]) planes[bits.length + (i >> 3)] |= 0x80 >> (i & 7);
  }
  return planes;
}

/**
 * What the terminal shows for an item: its own black and white picture,
 * else its photo in black and white, else the catalogue fallback.
 */
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
  return (await photoBitmap(imageKey)) ?? fallbackProductImage();
}
