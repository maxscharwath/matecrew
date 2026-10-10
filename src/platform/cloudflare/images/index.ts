import { getCloudflareContext } from "@opennextjs/cloudflare";
import { WEB_IMAGE_MAX_SIZE, WEB_IMAGE_QUALITY, type ImageProcessor } from "../../ports/images";
import { greyscaleSquare } from "./grey";
import { decodePng } from "./png";

/** The `IMAGES` binding of the request (or scheduled run, or queue batch) being served. */
function images(): ImagesBinding {
  // Optional in OpenNext's own declaration, which uses it for next/image.
  const binding = getCloudflareContext().env.IMAGES;
  if (!binding) throw new Error("The IMAGES binding is missing from wrangler.jsonc");
  return binding;
}

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([bytes as BlobPart]).stream();
}

async function bytesOf(result: ImageTransformationResult): Promise<Uint8Array> {
  return new Uint8Array(await result.response().arrayBuffer());
}

/**
 * Cloudflare Images through the Worker binding. It applies EXIF orientation
 * by itself and has no choice of resampling kernel, so pixel art is scaled
 * here instead (./grey.ts), after the binding decodes it.
 */
export const cloudflareImages: ImageProcessor = {
  async optimizeForWeb(input) {
    const result = await images()
      .input(stream(input))
      .transform({ width: WEB_IMAGE_MAX_SIZE, height: WEB_IMAGE_MAX_SIZE, fit: "scale-down" })
      .output({ format: "image/webp", quality: WEB_IMAGE_QUALITY });
    return bytesOf(result);
  },
  async size(input) {
    const info = await images().info(stream(input));
    if (!("width" in info)) throw new Error(`Unsupported picture: ${info.format}`);
    return { width: info.width, height: info.height };
  },
  async greyscaleSquare(input, side, kernel) {
    const picture = images().input(stream(input));
    // `contain` fits the square without margins and enlarges a small photo, as sharp's resize does.
    const fitted = kernel === "nearest" ? picture : picture.transform({ width: side, height: side, fit: "contain" });
    const png = await bytesOf(await fitted.output({ format: "image/png" }));
    return greyscaleSquare(await decodePng(png), side, kernel);
  },
};
