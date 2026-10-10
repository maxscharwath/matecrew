import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { cloudflareImages } from "../../src/platform/cloudflare/images";
import { decodePng } from "../../src/platform/cloudflare/images/png";
import { sharpImages } from "../../src/platform/node/images";
import { ITEM_IMAGE_BYTES, ITEM_IMAGE_SIZE, itemImage, pictureToBitmap, threshold } from "../../src/lib/device/bitmap";

const PHOTO = "public/textures/el-tony-mate-label-sm.jpg";
const SIDE = ITEM_IMAGE_SIZE;

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

type Transform = { width?: number; height?: number; fit?: string };

/**
 * The Images binding as wrangler's local mode implements it (sharp, EXIF
 * applied, `contain` and `scale-down` fit inside the box), recording what
 * the adapter asks for.
 */
function fakeImagesBinding(requests: { transforms: Transform[]; format: string; quality?: number }[]) {
  return {
    async info(stream: ReadableStream<Uint8Array>) {
      const { format, size, width, height } = await sharp(await bytesOf(stream)).metadata();
      return { format: `image/${format}`, fileSize: size ?? 0, width, height };
    },
    input(stream: ReadableStream<Uint8Array>) {
      const transforms: Transform[] = [];
      const transformer = {
        transform(options: Transform) {
          transforms.push(options);
          return transformer;
        },
        async output({ format, quality }: { format: string; quality?: number }) {
          requests.push({ transforms, format, quality });
          let image = sharp(await bytesOf(stream), { autoOrient: true });
          for (const { width, height, fit } of transforms) {
            image = image.resize(width, height, { fit: "inside", withoutEnlargement: fit === "scale-down" });
          }
          const out = await (format === "image/webp" ? image.webp({ quality }) : image.png()).toBuffer();
          return { response: () => new Response(new Uint8Array(out)), contentType: () => format };
        },
      };
      return transformer;
    },
  };
}

/** Serves `binding` as `getCloudflareContext().env.IMAGES` for the duration of `run`. */
async function withImagesBinding<T>(binding: unknown, run: () => Promise<T>): Promise<T> {
  const key = Symbol.for("__cloudflare-context__");
  const global = globalThis as Record<symbol, unknown>;
  global[key] = { env: { IMAGES: binding }, ctx: {}, cf: {} };
  try {
    return await run();
  } finally {
    delete global[key];
  }
}

function differingPixels(a: Uint8Array, b: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < SIDE * SIDE; i++) if (((a[i >> 3] ^ b[i >> 3]) & (0x80 >> (i & 7))) !== 0) count++;
  return count;
}

test("the PNG decoder reads every colour type and bit depth the way libvips does", async () => {
  const source = sharp(PHOTO).resize(37, 23).ensureAlpha(0.6);
  const variants = {
    rgb: source.clone().removeAlpha().png(),
    rgba: source.clone().png(),
    grey: source.clone().removeAlpha().greyscale().png(),
    greyAlpha: source.clone().greyscale().png(),
    palette: source.clone().png({ palette: true, colours: 16 }),
    twoColours: source.clone().removeAlpha().png({ palette: true, colours: 2 }),
    sixteenBit: source.clone().toColourspace("rgb16").png(),
  };
  for (const [name, png] of Object.entries(variants)) {
    const encoded = await png.toBuffer();
    const expected = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = await decodePng(new Uint8Array(encoded));
    assert.equal(decoded.width, expected.info.width, name);
    assert.equal(decoded.height, expected.info.height, name);
    assert.deepEqual(Buffer.from(decoded.data), expected.data, name);
  }
});

test("the Cloudflare adapter asks the binding for what sharp did and returns its WebP", async () => {
  const requests: { transforms: Transform[]; format: string; quality?: number }[] = [];
  const photo = new Uint8Array(await sharp(PHOTO).toBuffer());
  const optimized = await withImagesBinding(fakeImagesBinding(requests), () => cloudflareImages.optimizeForWeb(photo));
  assert.deepEqual(requests[0], { transforms: [{ width: 512, height: 512, fit: "scale-down" }], format: "image/webp", quality: 80 });
  const { format, width, height } = await sharp(optimized).metadata();
  assert.deepEqual([format, width, height], ["webp", 512, 341]);
});

test("Cloudflare and sharp grey squares give the same 1-bit picture of a stored photo, within 1%", async () => {
  const requests: { transforms: Transform[]; format: string }[] = [];
  const stored = new Uint8Array(await sharpImages.optimizeForWeb(new Uint8Array(await sharp(PHOTO).toBuffer())));
  const reference = await sharpImages.greyscaleSquare(stored, SIDE, "lanczos3");
  const grey = await withImagesBinding(fakeImagesBinding(requests), () =>
    cloudflareImages.greyscaleSquare(stored, SIDE, "lanczos3"),
  );
  assert.deepEqual(requests[0].transforms, [{ width: SIDE, height: SIDE, fit: "contain" }]);
  assert.equal(grey.length, SIDE * SIDE);
  const differing = differingPixels(threshold(reference, SIDE, SIDE).bits, threshold(grey, SIDE, SIDE).bits);
  assert.ok(differing <= (SIDE * SIDE) / 100, `${differing} pixels differ`);
});

test("pixel art keeps its pixels: scaled here by a whole factor, not by the binding", async () => {
  // A 24 x 24 checkerboard of 3 x 3 squares.
  const pixels = Uint8Array.from({ length: 24 * 24 }, (_, i) => ((Math.floor(i / 24 / 3) + Math.floor((i % 24) / 3)) % 2 ? 255 : 0));
  const png = new Uint8Array(await sharp(pixels, { raw: { width: 24, height: 24, channels: 1 } }).png().toBuffer());
  const requests: { transforms: Transform[]; format: string }[] = [];
  const grey = await withImagesBinding(fakeImagesBinding(requests), () => cloudflareImages.greyscaleSquare(png, SIDE, "nearest"));
  assert.deepEqual(requests[0].transforms, []);
  const reference = await sharpImages.greyscaleSquare(png, SIDE, "nearest");
  assert.deepEqual(Buffer.from(grey), Buffer.from(reference));
  // And through the business code: each source pixel is a 4 x 4 block.
  const bitmap = await pictureToBitmap(png, "threshold");
  const ink = (x: number, y: number) => (bitmap.bits[(y * SIDE + x) >> 3] & (0x80 >> ((y * SIDE + x) & 7))) !== 0;
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) assert.equal(ink(x, y), pixels[Math.floor(y / 4) * 24 + Math.floor(x / 4)] === 0);
});

test("the terminal shows the drawing, else the photo's picture, else the catalogue fallback", () => {
  const drawing = new Uint8Array(ITEM_IMAGE_BYTES).fill(0xff);
  const photo = new Uint8Array(ITEM_IMAGE_BYTES).fill(0x0f);
  assert.deepEqual(itemImage(drawing, photo).bits, drawing);
  assert.deepEqual(itemImage(null, photo).bits, photo);
  const fallback = itemImage(null, null);
  assert.equal(fallback.bits.length, ITEM_IMAGE_BYTES);
  assert.deepEqual(itemImage(new Uint8Array(72), null).bits, fallback.bits, "a picture of another size is ignored");
});
