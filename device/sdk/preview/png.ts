/** Minimal PNG for 1-bit frames: indexed colour, no filters. Also reads back the PNGs it writes (snapshots). */
import { deflateSync, inflateSync } from "node:zlib";
import type { Frame } from "./engine";

export type Rgb = [number, number, number];
/** E-paper look: warm paper, near-black ink. */
export const PAPER: Rgb = [0xf4, 0xf2, 0xec];
export const INK: Rgb = [0x1d, 0x1d, 0x1f];

/** Encode a 1-bit frame, optionally magnified by an integer factor (nearest neighbour). */
export function framePng(
  frame: Pick<Frame, "width" | "height" | "bits">,
  { scale = 1, paper = PAPER, ink = INK }: { scale?: number; paper?: Rgb; ink?: Rgb } = {},
): Uint8Array {
  const width = frame.width * scale;
  const height = frame.height * scale;
  const source = Math.ceil(frame.width / 8);
  const stride = Math.ceil(width / 8);
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const from = Math.floor(y / scale) * source;
    const to = y * (stride + 1) + 1;
    if (scale === 1) raw.set(frame.bits.subarray(from, from + source), to);
    else
      for (let x = 0; x < width; x++) {
        const sx = Math.floor(x / scale);
        if (frame.bits[from + (sx >> 3)] & (128 >> (sx & 7)))
          raw[to + (x >> 3)] |= 128 >> (x & 7);
      }
  }
  return png(width, height, 1, [paper, ink], raw);
}

/** Encode an 8-bit indexed image (one palette index per pixel). */
export function indexedPng(
  width: number,
  height: number,
  palette: Rgb[],
  pixels: Uint8Array,
): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++)
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  return png(width, height, 8, palette, raw);
}

/** Read a 1-bit indexed PNG written by `framePng` back into packed bits (index 1 = ink). */
export function readFramePng(bytes: Uint8Array): Pick<Frame, "width" | "height" | "bits"> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      if (body[8] !== 1 || body[9] !== 3) throw new Error("Not a 1-bit indexed frame PNG");
    }
    if (type === "IDAT") idat.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil(width / 8);
  const bits = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error("Unsupported PNG filter");
    bits.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, bits };
}

function png(
  width: number,
  height: number,
  depth: 1 | 8,
  palette: Rgb[],
  raw: Uint8Array,
): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([depth, 3, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", Uint8Array.from(palette.flat())),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
