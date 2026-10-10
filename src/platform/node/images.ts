import sharp from "sharp";
import { WEB_IMAGE_MAX_SIZE, WEB_IMAGE_QUALITY, type ImageProcessor } from "../ports/images";

const WHITE = "#ffffff";

/** libvips through sharp: native, fast, and the reference the other adapters are compared with. */
export const sharpImages: ImageProcessor = {
  optimizeForWeb(input) {
    return sharp(input)
      .rotate()
      .resize(WEB_IMAGE_MAX_SIZE, WEB_IMAGE_MAX_SIZE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEB_IMAGE_QUALITY })
      .toBuffer();
  },
  async size(input) {
    const { width, height } = await sharp(input).metadata();
    return { width, height };
  },
  greyscaleSquare(input, side, kernel) {
    return sharp(input, { autoOrient: true })
      .flatten({ background: WHITE })
      .resize(side, side, { fit: "contain", background: WHITE, kernel })
      .greyscale()
      .normalise()
      .raw()
      .toBuffer();
  },
};
