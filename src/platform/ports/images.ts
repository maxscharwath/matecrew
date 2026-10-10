/**
 * Image processing: item photos for the site, and the grey levels the badge
 * terminal's 1-bit pictures are made from (src/lib/device/bitmap.ts).
 */

/** Longest edge of a stored photo, in pixels. */
export const WEB_IMAGE_MAX_SIZE = 512;
/** WebP quality of a stored photo. */
export const WEB_IMAGE_QUALITY = 80;

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** How a picture is scaled: `nearest` keeps pixel art's pixels, `lanczos3` smooths a photo. */
export type ResizeKernel = "nearest" | "lanczos3";

export interface ImageProcessor {
  /**
   * An uploaded picture as it is stored: EXIF orientation applied, longest
   * edge capped at WEB_IMAGE_MAX_SIZE (never enlarged), WebP at
   * WEB_IMAGE_QUALITY. Rejects when the bytes are not a picture.
   */
  optimizeForWeb(input: Uint8Array): Promise<Uint8Array>;
  /** The picture's width and height, as stored. Rejects when the bytes are not a picture. */
  size(input: Uint8Array): Promise<ImageSize>;
  /**
   * The picture upright (EXIF orientation applied, as Cloudflare Images always
   * does), flattened on white, scaled to fit a `side` x `side` square and
   * centred on white, in grey levels stretched so that its 1st and 99th
   * percentiles of lightness become black and white: one byte per pixel
   * (0 = black), row after row.
   */
  greyscaleSquare(input: Uint8Array, side: number, kernel: ResizeKernel): Promise<Uint8Array>;
}
