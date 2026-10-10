/**
 * The panel's 1-bit frames in the browser: what /frame sends, drawn on a
 * canvas the way the SDK studio draws them, and how two of them differ, which
 * decides how the e-paper refreshes (device/sdk/emulator/refresh.ts and board.ts).
 */

export const PANEL_WIDTH = 800;
export const PANEL_HEIGHT = 480;
export const FRAME_BYTES = (PANEL_WIDTH * PANEL_HEIGHT) / 8;
/** E-paper off-white and its ink, as the studio paints them. */
export const PAPER_HEX = "#f4f2ec";
const PAPER = [0xf4, 0xf2, 0xec] as const;
const INK = [0x1d, 0x1d, 0x1f] as const;

/** A frame as the terminal uploaded it. */
export type MirrorFrame = { hash: string; drawnAt: string; bits: Uint8Array };

/** Changed window in panel pixels, byte-aligned horizontally like the firmware's. */
export type Box = { x: number; y: number; width: number; height: number };

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const pixel = ([r, g, b]: readonly [number, number, number]) =>
  LITTLE_ENDIAN ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
const INK_PIXEL = pixel(INK);
const PAPER_PIXEL = pixel(PAPER);

/** Paints packed MSB-first bits (1 = ink) on an 800 × 480 canvas. */
export function paintFrame(context: CanvasRenderingContext2D, bits: Uint8Array): void {
  const image = context.createImageData(PANEL_WIDTH, PANEL_HEIGHT);
  const pixels = new Uint32Array(image.data.buffer);
  for (let i = 0; i < pixels.length; i++) pixels[i] = bits[i >> 3] & (0x80 >> (i & 7)) ? INK_PIXEL : PAPER_PIXEL;
  context.putImageData(image, 0, 0);
}

/** Gets the frame /frame serves; throws when there is none or it is not a panel's. */
export async function fetchFrame(url: string, signal?: AbortSignal): Promise<MirrorFrame> {
  // no-cache: the browser revalidates with the ETag and the route answers 304 when nothing changed.
  const response = await fetch(url, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`frame: ${response.status}`);
  const body = (await response.json()) as { hash: string; drawnAt: string; bits: string };
  const binary = atob(body.bits);
  if (binary.length !== FRAME_BYTES) throw new Error(`frame: ${binary.length} bytes`);
  const bits = new Uint8Array(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES; i++) bits[i] = binary.charCodeAt(i);
  return { hash: body.hash, drawnAt: body.drawnAt, bits };
}

const ROW_BYTES = PANEL_WIDTH / 8;
const ONES = Uint8Array.from({ length: 256 }, (_, byte) => {
  let count = 0;
  for (let b = byte; b; b >>= 1) count += b & 1;
  return count;
});

/**
 * How the panel went from one frame to the next: the window around every
 * changed pixel, the share of pixels that turned, and the partial refreshes
 * the terminal spends on it (two for a new screen, past 6 %). Null when equal.
 */
export function compareFrames(before: Uint8Array, after: Uint8Array): { box: Box; percent: number; passes: 1 | 2 } | null {
  let top = -1;
  let bottom = -1;
  let left = ROW_BYTES;
  let right = -1;
  let turned = 0;
  for (let y = 0; y < PANEL_HEIGHT; y++)
    for (let b = 0; b < ROW_BYTES; b++) {
      const i = y * ROW_BYTES + b;
      const flipped = before[i] ^ after[i];
      if (!flipped) continue;
      turned += ONES[flipped];
      if (top < 0) top = y;
      bottom = y;
      left = Math.min(left, b);
      right = Math.max(right, b);
    }
  if (top < 0) return null;
  const percent = Math.floor((turned * 100) / (PANEL_WIDTH * PANEL_HEIGHT));
  return {
    box: { x: left * 8, y: top, width: (right + 1 - left) * 8, height: bottom - top + 1 },
    percent,
    passes: percent >= 6 ? 2 : 1,
  };
}

/**
 * Width to draw the panel at in `available` CSS pixels: a whole number of
 * device pixels per panel pixel, so every pixel is the same size, unless that
 * leaves it small (under half the room, or under 480 px when there is more):
 * then all the room, as on a phone. Pixelated when it is enlarged, smoothed
 * when it has to shrink, so thin lines never vanish.
 */
export function fitPanel(available: number, dpr: number): { width: number; pixelated: boolean } {
  const scale = (available * dpr) / PANEL_WIDTH;
  if (scale < 1) return { width: available, pixelated: false };
  const exact = (PANEL_WIDTH * Math.floor(scale)) / dpr;
  return { width: exact >= Math.max(available / 2, Math.min(available, 480)) ? exact : available, pixelated: true };
}
