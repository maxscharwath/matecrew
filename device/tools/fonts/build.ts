/**
 * OWT's brand faces as the engine's bitmap fonts: Montserrat for text, Space Grotesk for
 * headings, as on owt.swiss. Draws each glyph of the variable fonts in this folder at the sizes
 * of the `grotesk` family, one bit per pixel, and writes u8g2 fonts to device/engine/src/fonts/.
 *
 *   bun device/tools/fonts/build.ts            # rewrite the fonts
 *   bun device/tools/fonts/build.ts --sheet    # also draw every size to device/out/fonts.png
 *
 * Without hinting instructions, a light grid fit stands in: baseline, x-height, capitals and
 * ascenders land on whole pixels (overshoots flatten below half a pixel), and each glyph moves
 * by up to half a pixel sideways to put its stems on pixel edges.
 */
import { deflateSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Font, type Point } from "./ttf";
import { decode, encode, type Glyph, type Header } from "./u8g2";

const here = new URL("./", import.meta.url);
const root = new URL("../../../", import.meta.url);
const target = new URL("device/engine/src/fonts/", root);

/** The `grotesk` ladder, named by the capital height of the Free Universal fonts it replaced. 49 holds figures only. */
const SIZES = [11, 14, 17, 20, 25, 30, 35, 42, 49];
/**
 * Line boxes (height, bottom) of the Free Universal fonts these replace, by size: the engine
 * and the kit's type scale place text by them, so layouts keep their rhythm. The figures-only
 * size takes its own glyphs' box.
 */
const REGULAR_BOX: Record<number, [number, number]> = { 11: [20, -4], 14: [26, -5], 17: [30, -6], 20: [35, -7], 25: [45, -9], 30: [54, -11], 35: [64, -13], 42: [76, -15] };
const BOLD_BOX: Record<number, [number, number]> = { 11: [21, -4], 14: [26, -5], 17: [31, -6], 20: [36, -7], 25: [46, -9], 30: [54, -11], 35: [65, -13], 42: [77, -15] };

/**
 * Capital height in pixels at each size. Space Grotesk's capitals are the size. Montserrat's
 * lowercase stands taller (x-height 0.75 of the capitals, against 0.71) and wider: 6 % shorter
 * capitals keep the x-height of the old text and most of its line lengths.
 */
const FULL = (size: number) => size;
const TEXT_CAPS = (size: number) => Math.round(size * 0.94);
/**
 * Instances on the `wght` axis whose stems take as many pixels as the old fonts' did, at every
 * size (regular 1-2-2-3-3 px from 11 to 25, bold 2-3-3-4-5): Montserrat 400 fades to one-pixel
 * strokes on dithered surfaces, 700 fills its counters at 17 px.
 */
const FACES = [
  { name: "montserrat_regular", file: "montserrat/Montserrat[wght].ttf", wght: 500, box: REGULAR_BOX, caps: TEXT_CAPS },
  // Bold text from 20 px up is Space Grotesk (`HEADING_FROM` in engine/src/scene/typography.rs).
  { name: "montserrat_bold", file: "montserrat/Montserrat[wght].ttf", wght: 650, box: BOLD_BOX, caps: TEXT_CAPS, sizes: [11, 14, 17] },
  { name: "space_grotesk_bold", file: "spacegrotesk/SpaceGrotesk[wght].ttf", wght: 700, box: BOLD_BOX, caps: FULL },
];

/**
 * Printable ASCII, Latin-1, French typesetting's punctuation and spaces, arrows and a few signs,
 * where the face has them (neither draws ✓; Montserrat has no soft hyphen).
 */
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const TEXT = [
  ...range(0x20, 0x7e),
  ...range(0xa0, 0xff),
  ...[..."ŒœŸ–—‘’‚“”„•…‹›€−✓\u2009\u202f←↑→↓≤≥"].map((c) => c.codePointAt(0)!),
];
/** Characters a face lacks, drawn as another: the narrow no-break space (French `50 %`) as the thin space. */
const STAND_INS: Record<number, number> = { 0x202f: 0x2009 };
const FIGURES = [..." *+,-./0123456789:"].map((c) => c.codePointAt(0)!);

/** Coverage a pixel needs to take ink: under half, so one-pixel strokes between rows survive. */
const THRESHOLD = 0.45;
/** Sample rows per pixel; coverage along a row is exact. */
const ROWS = 16;

type Pt = { x: number; y: number };

/** Font units to pixels, y up, capitals `size` pixels tall: piecewise linear through the face's alignment zones. */
function gridFit(font: Font, size: number) {
  const extent = (c: string) => {
    const points = font.outline(font.glyphOf(c.codePointAt(0)!)!).contours.flat();
    return { bottom: Math.min(...points.map((p) => p.y)), top: Math.max(...points.map((p) => p.y)) };
  };
  const cap = extent("H").top;
  const scale = size / cap;
  const px = (units: number) => Math.round(units * scale);
  // An overshoot keeps its pixels only once it rounds to one.
  const zone = (flat: number, over: number, at = px(flat)): [number, number][] => [
    [flat, at],
    [over, at + px(over - flat)],
  ];
  const round = extent("O");
  const x = extent("x").top;
  const ascender = extent("l").top;
  const descender = extent("p").bottom;
  const knots: [number, number][] = [
    [descender, px(descender)],
    ...zone(0, round.bottom).reverse(),
    ...zone(x, extent("o").top),
    ...zone(cap, round.top, size),
  ];
  if (ascender > round.top + 1) knots.push([ascender, px(ascender)]);
  knots.sort((a, b) => a[0] - b[0]);
  const y = (u: number) => {
    if (u <= knots[0][0]) return knots[0][1] + (u - knots[0][0]) * scale;
    const last = knots.at(-1)!;
    if (u >= last[0]) return last[1] + (u - last[0]) * scale;
    let i = 1;
    while (u > knots[i][0]) i++;
    const [[u0, y0], [u1, y1]] = [knots[i - 1], knots[i]];
    return u1 === u0 ? y1 : y0 + ((u - u0) * (y1 - y0)) / (u1 - u0);
  };
  return { scale, y };
}

/** Quadratic TrueType contours as closed polylines. */
function polylines(contours: Point[][], map: (p: Pt) => Pt): Pt[][] {
  return contours
    .filter((c) => c.length > 1)
    .map((contour) => {
      // Start on a point on the curve, implied between two control points if need be.
      let points = contour;
      const first = points.findIndex((p) => p.on);
      if (first < 0) {
        const a = points[0];
        const b = points.at(-1)!;
        points = [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true }, ...points];
      } else points = [...points.slice(first), ...points.slice(0, first)];
      const out: Pt[] = [map(points[0])];
      const n = points.length;
      for (let i = 1; i <= n; i++) {
        const p = points[i % n];
        if (p.on) {
          out.push(map(p));
          continue;
        }
        const next = points[(i + 1) % n];
        const end = next.on ? next : { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2, on: true };
        const [a, c, b] = [out.at(-1)!, map(p), map(end)];
        const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 1.5));
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const u = 1 - t;
          out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
        }
        if (next.on) i++;
      }
      return out;
    });
}

/** Ink coverage of each pixel under the non-zero rule; pixel (i, j) spans [i, i+1) × [j, j+1), y up. */
function coverage(lines: Pt[][]) {
  const all = lines.flat();
  const left = Math.floor(Math.min(...all.map((p) => p.x)));
  const right = Math.ceil(Math.max(...all.map((p) => p.x)));
  const bottom = Math.floor(Math.min(...all.map((p) => p.y)));
  const top = Math.ceil(Math.max(...all.map((p) => p.y)));
  const width = right - left;
  const height = top - bottom;
  const cells = new Float64Array(width * height);
  const rows = edgeRows(lines, bottom, height);
  for (let row = 0; row < height * ROWS; row++) {
    const y = bottom + (row + 0.5) / ROWS;
    const j = Math.floor(row / ROWS);
    const crossings = crossingsAt(rows[j], y);
    let winding = 0;
    for (let k = 0; k < crossings.length - 1; k++) {
      winding += crossings[k][1];
      if (winding) addSpan(cells, j * width, width, crossings[k][0] - left, crossings[k + 1][0] - left);
    }
  }
  return { left, bottom, width, height, cells };
}

/** Edges by the pixel rows they cross, so each sample row looks at its own few. */
function edgeRows(lines: Pt[][], bottom: number, height: number): [Pt, Pt][][] {
  const rows: [Pt, Pt][][] = Array.from({ length: height }, () => []);
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const [a, b] = [line[i], line[(i + 1) % line.length]];
      if (a.y === b.y) continue;
      const [from, to] = [Math.floor(Math.min(a.y, b.y) - bottom), Math.ceil(Math.max(a.y, b.y) - bottom)];
      for (let j = Math.max(0, from); j < Math.min(height, to); j++) rows[j].push([a, b]);
    }
  }
  return rows;
}

/** Where the edges cross the line at height `y`, left to right, each with its direction (1 up, -1 down). */
function crossingsAt(edges: [Pt, Pt][], y: number): [number, number][] {
  const crossings: [number, number][] = [];
  for (const [a, b] of edges) {
    if (y < Math.min(a.y, b.y) || y >= Math.max(a.y, b.y)) continue;
    crossings.push([a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y), b.y > a.y ? 1 : -1]);
  }
  crossings.sort((p, q) => p[0] - q[0]);
  return crossings;
}

/** One sample row's share of the ink between `from` and `to` (pixels from the left edge), on the pixel row at `start`. */
function addSpan(cells: Float64Array, start: number, width: number, from: number, to: number): void {
  for (let i = Math.floor(from); i < to && i < width; i++) {
    const overlap = Math.min(to, i + 1) - Math.max(from, i);
    if (overlap > 0) cells[start + i] += overlap / ROWS;
  }
}

/** One glyph at one size, cropped to its ink; rows go top first. */
function draw(font: Font, code: number, fit: ReturnType<typeof gridFit>): Glyph | undefined {
  const index = font.glyphOf(code) ?? font.glyphOf(STAND_INS[code] ?? code);
  if (index === undefined) return undefined;
  const outline = font.outline(index);
  const advance = Math.round(outline.advance * fit.scale);
  const blank = { code, width: 0, height: 0, x: 0, y: 0, advance, bits: new Uint8Array() };
  if (!outline.contours.some((c) => c.length > 1)) return blank;
  const drawn = sharpest(outline.contours, fit);
  const ink = inkBox(drawn);
  if (!ink) return blank;
  const { left, bottom, width, cells } = drawn;
  const { x0, y0, y1 } = ink;
  const w = ink.x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const bits = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let i = 0; i < w; i++) bits[r * w + i] = cells[(y1 - r) * width + x0 + i] >= THRESHOLD ? 1 : 0;
  }
  return { code, width: w, height: h, x: left + x0, y: bottom + y0, advance, bits };
}

/** The contours' coverage at the sideways shift (in eighths of a pixel) that leaves the fewest grey pixels. */
function sharpest(contours: Point[][], fit: ReturnType<typeof gridFit>): ReturnType<typeof coverage> {
  let best: { grey: number; drawn: ReturnType<typeof coverage> } | undefined;
  for (const shift of [0, 1, -1, 2, -2, 3, -3, 4].map((n) => n / 8)) {
    const drawn = coverage(polylines(contours, (p) => ({ x: p.x * fit.scale + shift, y: fit.y(p.y) })));
    const grey = drawn.cells.reduce((sum, c) => sum + Math.min(c, 1 - Math.min(c, 1)), 0);
    if (!best || grey < best.grey - 1e-9) best = { grey, drawn };
  }
  return best!.drawn;
}

/** The inked pixels' bounds, rows counted from the bottom; undefined when nothing takes ink. */
function inkBox({ width, height, cells }: ReturnType<typeof coverage>) {
  let [x0, x1, y0, y1] = [width, -1, height, -1];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (cells[j * width + i] < THRESHOLD) continue;
      [x0, x1, y0, y1] = [Math.min(x0, i), Math.max(x1, i), Math.min(y0, j), Math.max(y1, j)];
    }
  }
  return x1 < 0 ? undefined : { x0, x1, y0, y1 };
}

/** A face at one size: its glyphs, encoded, in the line box the engine places them by. */
function buildFont(face: (typeof FACES)[number], font: Font, size: number) {
  const name = `${face.name}_${size}`;
  const fit = gridFit(font, face.caps(size));
  const codes = size === 49 ? FIGURES : TEXT;
  const glyphs = codes.map((code) => draw(font, code, fit)).filter((g): g is Glyph => !!g);
  const inked = glyphs.filter((g) => g.width);
  const x = Math.min(...inked.map((g) => g.x));
  const bottom = Math.min(...inked.map((g) => g.y));
  const [height, y] = face.box[size] ?? [Math.max(...inked.map((g) => g.y + g.height)) - bottom, bottom];
  const box: Header["box"] = { width: Math.max(...inked.map((g) => g.x + g.width)) - x, height, x, y };
  const data = encode(glyphs, box);
  // The engine's reader must give back every pixel.
  const back = decode(data).glyphs;
  for (const g of glyphs) {
    const b = back.find((d) => d.code === g.code);
    if (b?.advance !== g.advance || b.x !== g.x || b.y !== g.y || b.bits.join("") !== g.bits.join("")) {
      throw new Error(`${name}: U+${g.code.toString(16)} does not survive encoding`);
    }
  }
  const out = inked.filter((g) => g.y < y || g.y + g.height > y + height).map((g) => String.fromCodePoint(g.code));
  if (out.length) console.warn(`${name}: outside the line box: ${out.join("")}`);
  return { name, glyphs, box, data };
}

// Every face file is read first; the fonts then build in order, so warnings come out in order.
const files = await Promise.all(FACES.map((face) => readFile(new URL(face.file, here))));
const sheet = FACES.flatMap((face, i) => {
  const font = new Font(new Uint8Array(files[i]));
  font.setVariation({ wght: face.wght });
  return (face.sizes ?? SIZES).map((size) => buildFont(face, font, size));
});
await mkdir(target, { recursive: true });
await Promise.all(sheet.map(({ name, data }) => writeFile(new URL(`${name}.u8g2font`, target), data)));
const total = sheet.reduce((sum, { data }) => sum + data.length, 0);
console.log(`${sheet.length} fonts, ${total} bytes, in ${target.pathname}`);
const LICENSES = [["montserrat/OFL.txt", "OFL-Montserrat.txt"], ["spacegrotesk/OFL.txt", "OFL-SpaceGrotesk.txt"]];
await Promise.all(LICENSES.map(async ([from, to]) => writeFile(new URL(to, target), await readFile(new URL(from, here)))));

if (process.argv.includes("--sheet")) {
  // Every font on a line: its name's glyphs then a pangram, black on white.
  const sample = "Maté Classic 36 · Pose ton badge — Øl’œuvre «déjà» 0123456789 €";
  const lines = sheet.map(({ glyphs, box }) => ({ glyphs, box, text: glyphs.length < 30 ? "0123456789 +-.,:/*" : sample }));
  const width = 1600;
  const height = lines.reduce((sum, l) => sum + l.box.height + 6, 8);
  const pixels = new Uint8Array(width * height).fill(1);
  let top = 4;
  for (const { glyphs, box, text } of lines) {
    const baseline = top + box.height + box.y;
    let pen = 8;
    for (const char of text) {
      const g = glyphs.find((d) => d.code === char.codePointAt(0)) ?? glyphs.find((d) => d.code === 0x3f);
      if (!g) continue;
      for (let r = 0; r < g.height; r++) {
        for (let i = 0; i < g.width; i++) {
          const [px, py] = [pen + g.x + i, baseline - g.y - g.height + r];
          if (g.bits[r * g.width + i] && px < width && py >= 0 && py < height) pixels[py * width + px] = 0;
        }
      }
      pen += g.advance;
    }
    top += box.height + 6;
  }
  await mkdir(new URL("device/out/", root), { recursive: true });
  await writeFile(new URL("device/out/fonts.png", root), png(width, height, pixels));
  console.log("specimen: device/out/fonts.png");
}

/** A grey PNG from 0/1 pixels. */
function png(width: number, height: number, pixels: Uint8Array) {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = pixels[y * width + x] ? 255 : 0;
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header.set([8, 0, 0, 0, 0], 8);
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  return Buffer.concat(parts);
}
