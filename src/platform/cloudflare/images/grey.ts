/**
 * The grey-level steps of the terminal pictures, in plain JavaScript, written
 * to give what sharp (libvips) gives: flatten on white, greyscale, fit in a
 * square with white margins, normalise.
 */
import type { ResizeKernel } from "../../ports/images";
import type { RgbaImage } from "./png";

const WHITE = 255;
/** CIE L* thresholds: (6/29)^3 and the slope of the linear part below it. */
const EPSILON = (6 / 29) ** 3;
const SLOPE = 3 * (6 / 29) ** 2;

/** Linear light (0-1) of each sRGB level. */
const LINEAR = Float64Array.from({ length: 256 }, (_, level) => {
  const c = level / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** CIE L* (0-100) of each sRGB grey level. */
const LIGHTNESS = LINEAR.map((y) => 116 * (y > EPSILON ? Math.cbrt(y) : y / SLOPE + 4 / 29) - 16);

/** Linear light back to an sRGB level, clipped to 0-255. */
function toSrgb(linear: number): number {
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.min(WHITE, Math.max(0, Math.round(c * WHITE)));
}

/** Linear light of a CIE L*, unclipped. */
function fromLightness(lightness: number): number {
  const f = (lightness + 16) / 116;
  return f > 6 / 29 ? f ** 3 : SLOPE * (f - 4 / 29);
}

/** Each pixel composited on white and reduced to its luminance (Rec. 709, in linear light). */
export function flattenToGrey({ width, height, data }: RgbaImage): Uint8Array {
  const grey = new Uint8Array(width * height);
  for (let i = 0; i < grey.length; i++) {
    const alpha = data[i * 4 + 3] / WHITE;
    const linear = (channel: number) => LINEAR[Math.round(data[i * 4 + channel] * alpha + WHITE * (1 - alpha))];
    grey[i] = toSrgb(0.2126 * linear(0) + 0.7152 * linear(1) + 0.0722 * linear(2));
  }
  return grey;
}

interface GreyImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** Scaled to fit a `side` square, each pixel copied from the nearest source pixel. */
export function fitNearest({ width, height, data }: GreyImage, side: number): GreyImage {
  const scale = side / Math.max(width, height);
  const fitted = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  const out = new Uint8Array(fitted.width * fitted.height);
  for (let y = 0; y < fitted.height; y++) {
    const row = Math.floor((y * height) / fitted.height) * width;
    for (let x = 0; x < fitted.width; x++) out[y * fitted.width + x] = data[row + Math.floor((x * width) / fitted.width)];
  }
  return { ...fitted, data: out };
}

/** Centred on a white `side` square; whatever overflows it is cut off evenly. */
export function centre({ width, height, data }: GreyImage, side: number): Uint8Array {
  const out = new Uint8Array(side * side).fill(WHITE);
  const left = Math.floor((side - width) / 2);
  const top = Math.floor((side - height) / 2);
  for (let y = Math.max(0, -top); y < Math.min(height, side - top); y++) {
    for (let x = Math.max(0, -left); x < Math.min(width, side - left); x++) {
      out[(top + y) * side + left + x] = data[y * width + x];
    }
  }
  return out;
}

/**
 * libvips' vips_percent() on whole-number lightness: the histogram runs up to
 * the lightest bin used (`top`), its cumulative counts are scaled to 0-`top`
 * and truncated, and the answer is the first bin past `percent` of `top + 1`.
 * So the 1st percentile is the first bin reaching 2% of the pixels, and the
 * 99th is the lightest bin.
 */
function percentile(histogram: Uint32Array, total: number, percent: number): number {
  const top = histogram.findLastIndex((count) => count > 0);
  const limit = (percent / 100) * (top + 1);
  let cumulative = 0;
  for (let bin = 0; bin < top; bin++) {
    cumulative += histogram[bin];
    if (Math.floor((cumulative * top) / total) > limit) return bin;
  }
  return top;
}

/**
 * sharp's normalise(): lightness stretched so that its 1st percentile becomes
 * black and its 99th white; left as is when that range is one step or less.
 */
export function normalise(grey: Uint8Array): Uint8Array {
  const histogram = new Uint32Array(101);
  for (const level of grey) histogram[Math.trunc(LIGHTNESS[level])]++;
  const low = percentile(histogram, grey.length, 1);
  const high = percentile(histogram, grey.length, 99);
  if (Math.abs(high - low) <= 1) return grey;
  const factor = 100 / (high - low);
  const stretched = Uint8Array.from(LIGHTNESS, (lightness) => toSrgb(fromLightness((lightness - low) * factor)));
  return grey.map((level) => stretched[level]);
}

/**
 * A decoded picture as the port's grey square. With `lanczos3` the picture
 * comes already scaled to fit (the Images binding does it); with `nearest` it
 * comes at its own size and is scaled here, which the binding cannot do.
 */
export function greyscaleSquare(image: RgbaImage, side: number, kernel: ResizeKernel): Uint8Array {
  const grey = { width: image.width, height: image.height, data: flattenToGrey(image) };
  const fitted = kernel === "nearest" ? fitNearest(grey, side) : grey;
  return normalise(centre(fitted, side));
}
