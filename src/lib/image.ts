import sharp from "sharp";

const MAX_DIMENSION = 512;
const WEBP_QUALITY = 80;

/**
 * Normalize an uploaded image for storage: honor EXIF orientation, cap the
 * longest edge at MAX_DIMENSION (never upscaling), and re-encode as WebP.
 * Throws if the buffer is not a decodable image.
 */
export async function optimizeImage(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}
