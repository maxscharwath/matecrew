/** Converts a device-produced frame for the console mirror. No layout is rendered here. */
import sharp from "sharp";
const SCREEN_WIDTH = 800;
const SCREEN_HEIGHT = 480;
/** PNG of exactly what the panel will show, for the admin preview. */
export async function bitsToPng(bits: Buffer): Promise<Buffer> {
  const gray = Buffer.alloc(SCREEN_WIDTH * SCREEN_HEIGHT);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = bits[i >> 3] & (0x80 >> (i & 7)) ? 0 : 255;
  }
  return sharp(gray, { raw: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, channels: 1 } })
    .png()
    .toBuffer();
}
