/**
 * A PNG decoder for what the Images binding returns: non-interlaced, any
 * colour type, 1 to 16 bits per sample. The image data is inflated with the
 * runtime's DecompressionStream, so there is no WebAssembly to load.
 */

/** Pixels as 8-bit RGBA, row after row. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

interface Header {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlaced: boolean;
}

interface Chunks {
  header: Header;
  palette: Uint8Array | null;
  transparency: Uint8Array | null;
  compressed: Uint8Array[];
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Samples per pixel for each PNG colour type: grey, -, RGB, palette, grey + alpha, -, RGBA. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function readChunks(bytes: Uint8Array): Chunks {
  if (!SIGNATURE.every((byte, i) => bytes[i] === byte)) throw new Error("Not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Omit<Chunks, "header"> & { header: Header | null } = {
    header: null,
    palette: null,
    transparency: null,
    compressed: [],
  };
  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCodePoint(...bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const data = bytes.subarray(start, start + length);
    offset = start + length + 4;
    if (type === "IHDR") {
      found.header = {
        width: view.getUint32(start),
        height: view.getUint32(start + 4),
        depth: data[8],
        colorType: data[9],
        interlaced: data[12] !== 0,
      };
    } else if (type === "PLTE") found.palette = data;
    else if (type === "tRNS") found.transparency = data;
    else if (type === "IDAT") found.compressed.push(data);
    else if (type === "IEND") break;
  }
  const { header } = found;
  if (!header) throw new Error("PNG without a header");
  return { ...found, header };
}

async function inflate(parts: Uint8Array[]): Promise<Uint8Array> {
  const stream = new Blob(parts as BlobPart[]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/** Undoes one row's filter in place; `previous` is the row above, already unfiltered. */
function unfilterRow(filter: number, row: Uint8Array, previous: Uint8Array, step: number): void {
  for (let i = 0; i < row.length; i++) {
    const left = i >= step ? row[i - step] : 0;
    const up = previous[i];
    const upLeft = i >= step ? previous[i - step] : 0;
    let predicted = 0;
    if (filter === 1) predicted = left;
    else if (filter === 2) predicted = up;
    else if (filter === 3) predicted = (left + up) >> 1;
    else if (filter === 4) predicted = paeth(left, up, upLeft);
    row[i] = (row[i] + predicted) & 0xff;
  }
}

/** The rows' bytes without their filter bytes, unfiltered. */
function unfilter(raw: Uint8Array, header: Header): Uint8Array[] {
  const bits = CHANNELS[header.colorType] * header.depth;
  const stride = Math.ceil((header.width * bits) / 8);
  const step = Math.max(1, bits >> 3);
  const rows: Uint8Array[] = [];
  let previous = new Uint8Array(stride);
  for (let y = 0; y < header.height; y++) {
    const start = y * (stride + 1);
    const row = raw.slice(start + 1, start + 1 + stride);
    if (row.length < stride) throw new Error("Truncated PNG");
    unfilterRow(raw[start], row, previous, step);
    rows.push(row);
    previous = row;
  }
  return rows;
}

/** The `index`-th sample of a row, at full precision. */
function sample(row: Uint8Array, index: number, depth: number): number {
  if (depth === 8) return row[index];
  if (depth === 16) return (row[index * 2] << 8) | row[index * 2 + 1];
  const perByte = 8 / depth;
  const shift = 8 - depth * ((index % perByte) + 1);
  return (row[Math.floor(index / perByte)] >> shift) & ((1 << depth) - 1);
}

/** A sample scaled to 8 bits. */
function level(value: number, depth: number): number {
  if (depth === 8) return value;
  if (depth === 16) return value >> 8;
  return Math.round((value * 255) / ((1 << depth) - 1));
}

/** One pixel of the row as RGBA, written to `out` at `at`. */
type PixelWriter = (row: Uint8Array, x: number, out: Uint8Array, at: number) => void;

function writer({ header, palette, transparency }: Chunks): PixelWriter {
  const { depth } = header;
  const raw = (row: Uint8Array, index: number) => sample(row, index, depth);
  const scaled = (row: Uint8Array, index: number) => level(raw(row, index), depth);
  // tRNS for grey and RGB: the one sample value (or triple) that is transparent.
  const key = (index: number) => (transparency ? (transparency[index * 2] << 8) | transparency[index * 2 + 1] : -1);
  switch (header.colorType) {
    case 0:
      return (row, x, out, at) => {
        out.fill(scaled(row, x), at, at + 3);
        out[at + 3] = raw(row, x) === key(0) ? 0 : 255;
      };
    case 2:
      return (row, x, out, at) => {
        const opaque = [0, 1, 2].some((c) => raw(row, x * 3 + c) !== key(c));
        for (let c = 0; c < 3; c++) out[at + c] = scaled(row, x * 3 + c);
        out[at + 3] = opaque ? 255 : 0;
      };
    case 3:
      if (!palette) throw new Error("PNG without a palette");
      return (row, x, out, at) => {
        const entry = raw(row, x);
        out.set(palette.subarray(entry * 3, entry * 3 + 3), at);
        out[at + 3] = transparency && entry < transparency.length ? transparency[entry] : 255;
      };
    case 4:
      return (row, x, out, at) => {
        out.fill(scaled(row, x * 2), at, at + 3);
        out[at + 3] = scaled(row, x * 2 + 1);
      };
    case 6:
      return (row, x, out, at) => {
        for (let c = 0; c < 4; c++) out[at + c] = scaled(row, x * 4 + c);
      };
    default:
      throw new Error(`Unknown PNG colour type ${header.colorType}`);
  }
}

export async function decodePng(bytes: Uint8Array): Promise<RgbaImage> {
  const chunks = readChunks(bytes);
  const { header } = chunks;
  if (header.interlaced) throw new Error("Interlaced PNG");
  const rows = unfilter(await inflate(chunks.compressed), header);
  const write = writer(chunks);
  const data = new Uint8Array(header.width * header.height * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < header.width; x++) write(row, x, data, (y * header.width + x) * 4);
  });
  return { width: header.width, height: header.height, data };
}
