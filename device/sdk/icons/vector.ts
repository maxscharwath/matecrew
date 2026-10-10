/**
 * Vector art to packed 1-bit sprites, at compile time. Pure TypeScript and deterministic, so a
 * build gives the same bits on every machine (`dui check` compares them).
 *
 * Strokes keep an exact pixel width with round caps and joins; fills support non-zero and
 * even-odd rules and an ordered-dither tone for greys. Every pixel is sampled 4 × 4 and inked
 * when at least half of its samples are covered.
 */

/** An SVG attribute value. */
type Attribute = string | number | undefined;
/** Lucide's element list: `[tag, attributes]`. */
export type VectorNode = [string, Record<string, Attribute>];
type Point = [number, number];
/** A shape to draw. `tone` (0–100) dithers a fill; 100 is solid ink, 0 erases to paper. */
export type Paint = {
  nodes: VectorNode[];
  /** Stroke width in output pixels; 0 for none. */
  stroke?: number;
  /** Fill the closed outlines too. */
  fill?: boolean;
  tone?: number;
  rule?: "nonzero" | "evenodd";
};
export type Sprite = { width: number; height: number; bits: number[] };

const SAMPLES = 4;
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * Draw `layers` in order onto a `width` × `height` sprite. Coordinates are in `viewBox` units
 * (Lucide uses 24 × 24); `stroke` is in output pixels whatever the scale.
 */
export function rasterize(
  layers: Paint[],
  width: number,
  height = width,
  viewBox: [number, number, number, number] = [0, 0, 24, 24],
): Sprite {
  const scale = Math.min(width / viewBox[2], height / viewBox[3]);
  const dx = (width - viewBox[2] * scale) / 2 - viewBox[0] * scale;
  const dy = (height - viewBox[3] * scale) / 2 - viewBox[1] * scale;
  const ink = new Uint8Array(width * height);
  for (const layer of layers) paint(ink, layer, { width, height, scale, dx, dy });
  const bits = new Array<number>(Math.ceil((width * height) / 8)).fill(0);
  ink.forEach((on, i) => {
    if (on) bits[i >> 3] |= 128 >> (i & 7);
  });
  return { width, height, bits };
}

/** The sprite's size and the viewBox-to-pixel transform. */
type Placement = { width: number; height: number; scale: number; dx: number; dy: number };

function paint(ink: Uint8Array, layer: Paint, { width, height, scale, dx, dy }: Placement): void {
  const outlines = layer.nodes.flatMap((node) => outlinesOf(node, scale)).map((outline) => ({
    closed: outline.closed,
    points: outline.points.map(([x, y]): Point => [x * scale + dx, y * scale + dy]),
  }));
  const tone = Math.max(0, Math.min(100, layer.tone ?? 100));
  const coverage = new Uint8Array(width * height * SAMPLES * SAMPLES);
  const W = width * SAMPLES;
  if (layer.fill) fillSamples(coverage, W, height * SAMPLES, outlines.map((o) => o.points), layer.rule ?? "nonzero");
  if (layer.stroke) {
    for (const outline of outlines) strokeSamples(coverage, W, height * SAMPLES, outline.points, outline.closed, layer.stroke / 2);
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (samplesCovered(coverage, W, x, y) * 2 < SAMPLES * SAMPLES) continue;
      // Ordered dither: a 50 % tone inks every other pixel, 25 % one in four.
      ink[y * width + x] = BAYER[y & 3][x & 3] * 100 + 50 < tone * 16 ? 1 : 0;
    }
}

/** How many of pixel (x, y)'s samples are covered. */
function samplesCovered(coverage: Uint8Array, W: number, x: number, y: number): number {
  let covered = 0;
  for (let j = 0; j < SAMPLES; j++)
    for (let i = 0; i < SAMPLES; i++) covered += coverage[(y * SAMPLES + j) * W + x * SAMPLES + i];
  return covered;
}

function segmentsOf(points: Point[], closed: boolean): [Point, Point][] {
  const segments: [Point, Point][] = [];
  for (let i = 1; i < points.length; i++) segments.push([points[i - 1], points[i]]);
  if (closed && points.length > 2) segments.push([points.at(-1)!, points[0]]);
  if (points.length === 1) segments.push([points[0], points[0]]);
  return segments;
}

function strokeSamples(out: Uint8Array, W: number, H: number, points: Point[], closed: boolean, radius: number): void {
  const r = radius * SAMPLES;
  for (const [a, b] of segmentsOf(points, closed)) strokeSegment(out, W, H, a, b, r);
}

/** Every sample within `r` samples of segment a–b: a capsule, so caps and joins come out round. */
function strokeSegment(out: Uint8Array, W: number, H: number, a: Point, b: Point, r: number): void {
  const ax = a[0] * SAMPLES, ay = a[1] * SAMPLES, bx = b[0] * SAMPLES, by = b[1] * SAMPLES;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r));
  const vx = bx - ax, vy = by - ay;
  const length = vx * vx + vy * vy;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - ax, py = y + 0.5 - ay;
      const t = length ? Math.max(0, Math.min(1, (px * vx + py * vy) / length)) : 0;
      const ex = px - t * vx, ey = py - t * vy;
      if (ex * ex + ey * ey <= r * r) out[y * W + x] = 1;
    }
}

/** An edge in samples: [ax, ay, bx, by]. */
type Edge = [number, number, number, number];

/** The non-horizontal edges of closed polygons. */
function edgesOf(polygons: Point[][]): Edge[] {
  const edges: Edge[] = [];
  for (const polygon of polygons)
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if (a[1] !== b[1]) edges.push([a[0] * SAMPLES, a[1] * SAMPLES, b[0] * SAMPLES, b[1] * SAMPLES]);
    }
  return edges;
}

/** Where the edges cross the line y = `cy`, left to right, each with its direction (1 down, -1 up). */
function crossingsAt(edges: Edge[], cy: number): [number, number][] {
  const crossings: [number, number][] = [];
  for (const [ax, ay, bx, by] of edges)
    if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) crossings.push([ax + ((cy - ay) / (by - ay)) * (bx - ax), by > ay ? 1 : -1]);
  crossings.sort((p, q) => p[0] - q[0]);
  return crossings;
}

function fillSamples(out: Uint8Array, W: number, H: number, polygons: Point[][], rule: "nonzero" | "evenodd"): void {
  const edges = edgesOf(polygons);
  for (let y = 0; y < H; y++) {
    const crossings = crossingsAt(edges, y + 0.5);
    let winding = 0;
    for (let k = 0; k < crossings.length - 1; k++) {
      winding = rule === "evenodd" ? winding ^ 1 : winding + crossings[k][1];
      if (!winding) continue;
      const from = Math.max(0, Math.ceil(crossings[k][0] - 0.5)), to = Math.min(W - 1, Math.floor(crossings[k + 1][0] - 0.5));
      for (let x = from; x <= to; x++) out[y * W + x] = 1;
    }
  }
}

type Outline = { points: Point[]; closed: boolean };
const number = (value: Attribute, fallback = 0) => (value === undefined ? fallback : Number(value));

/** Outlines of one element, flattened finely enough for `scale` pixels per unit, transformed. */
function outlinesOf(node: VectorNode, scale: number): Outline[] {
  const transform = node[1].transform;
  const outlines = untransformed(node, scale);
  if (!transform) return outlines;
  const [a, b, c, d, e, f] = matrix(String(transform));
  return outlines.map(({ points, closed }) => ({
    closed,
    points: points.map(([x, y]): Point => [a * x + c * y + e, b * x + d * y + f]),
  }));
}

/** `[name, arguments]` of each `name(arguments)` in an SVG `transform` list. */
function transformCalls(list: string): [string, string][] {
  // A call ends at the first ")" after its "(", so each ")"-terminated chunk holds at most one.
  return list
    .split(")")
    .slice(0, -1)
    .flatMap((chunk) => {
      const call = callIn(chunk);
      return call ? [call] : [];
    });
}

/** The first `name(` in `chunk` (word characters, optional spaces, a parenthesis) and what follows it. */
function callIn(chunk: string): [string, string] | undefined {
  for (let open = chunk.indexOf("("); open >= 0; open = chunk.indexOf("(", open + 1)) {
    const head = chunk.slice(0, open).trimEnd();
    let start = head.length;
    while (start > 0 && /\w/.test(head[start - 1])) start--;
    if (start < head.length) return [head.slice(start), chunk.slice(open + 1)];
  }
  return undefined;
}

/** SVG `transform` list to one affine matrix [a b c d e f]. */
function matrix(list: string): number[] {
  let m = [1, 0, 0, 1, 0, 0];
  const multiply = (n: number[]) => {
    m = [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  };
  for (const [name, args] of transformCalls(list)) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    switch (name) {
      case "translate":
        multiply([1, 0, 0, 1, v[0], v[1] ?? 0]);
        break;
      case "scale":
        multiply([v[0], 0, 0, v[1] ?? v[0], 0, 0]);
        break;
      case "rotate": {
        const r = (v[0] * Math.PI) / 180, cx = v[1] ?? 0, cy = v[2] ?? 0;
        multiply([1, 0, 0, 1, cx, cy]);
        multiply([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
        multiply([1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "matrix":
        multiply(v);
        break;
      default:
        throw new Error(`Unsupported SVG transform: ${name}`);
    }
  }
  return m;
}

function untransformed([tag, a]: VectorNode, scale: number): Outline[] {
  const steps = (length: number) => Math.max(4, Math.ceil(length * scale * 0.75));
  switch (tag) {
    case "path":
      return pathOutlines(String(a.d ?? ""), steps);
    case "line":
      return [{ points: [[number(a.x1), number(a.y1)], [number(a.x2), number(a.y2)]], closed: false }];
    case "polyline":
    case "polygon":
      return [{ points: pointList(a.points), closed: tag === "polygon" }];
    case "circle":
      return [ellipse([number(a.cx), number(a.cy)], number(a.r), number(a.r), steps)];
    case "ellipse":
      return [ellipse([number(a.cx), number(a.cy)], number(a.rx), number(a.ry), steps)];
    case "rect":
      return rectangle(a, steps);
    default:
      return [];
  }
}

/** An SVG `points` list: x and y pairs, separated by spaces or commas. */
function pointList(list: Attribute): Point[] {
  const values = String(list ?? "").trim().split(/[\s,]+/).map(Number);
  const points: Point[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i], values[i + 1]]);
  return points;
}

function ellipse([cx, cy]: Point, rx: number, ry: number, steps: (length: number) => number): Outline {
  const n = steps(2 * Math.PI * Math.max(rx, ry));
  const points: Point[] = [];
  for (let i = 0; i < n; i++) points.push([cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)]);
  return { points, closed: true };
}

/** A `rect`, its corners rounded by `rx` and `ry` (either one standing for both). */
function rectangle(a: VectorNode[1], steps: (length: number) => number): Outline[] {
  const x = number(a.x), y = number(a.y), w = number(a.width), h = number(a.height);
  const rx = Math.min(number(a.rx ?? a.ry), w / 2);
  const ry = Math.min(number(a.ry ?? a.rx), h / 2);
  if (!rx || !ry) return [{ points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }];
  return pathOutlines(
    `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
    steps,
  );
}

const isLetter = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isDigit = (s: string, i: number): boolean => i < s.length && s[i] >= "0" && s[i] <= "9";

/** End of the run of digits from `i`. */
function digitsEnd(s: string, i: number): number {
  let end = i;
  while (isDigit(s, end)) end++;
  return end;
}

/** End of an exponent (`e`, an optional sign, digits) at `i`, or `i` if there is none. */
function exponentEnd(s: string, i: number): number {
  if (s[i] !== "e") return i;
  const digits = s[i + 1] === "-" || s[i + 1] === "+" ? i + 2 : i + 1;
  return isDigit(s, digits) ? digitsEnd(s, digits) : i;
}

/** End of the number at `i` (`-1`, `1.`, `.5`, `1.5e-3`), or `i` if none starts there. */
function numberEnd(s: string, i: number): number {
  const start = s[i] === "-" ? i + 1 : i;
  let end: number;
  if (isDigit(s, start)) {
    end = digitsEnd(s, start);
    if (s[end] === ".") end = digitsEnd(s, end + 1);
  } else if (s[start] === "." && isDigit(s, start + 1)) end = digitsEnd(s, start + 1);
  else return i;
  return exponentEnd(s, end);
}

/** Path data to command letters and numbers. Numbers need no separator: `1.5.5-2` is 1.5, .5 and -2. */
function pathTokens(d: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < d.length) {
    const end = isLetter(d[i]) ? i + 1 : numberEnd(d, i);
    if (end > i) tokens.push(d.slice(i, end));
    i = Math.max(end, i + 1);
  }
  return tokens;
}

/** SVG path data, every command, to polylines. */
export function pathOutlines(d: string, steps: (length: number) => number = (l) => Math.max(4, Math.ceil(l * 2))): Outline[] {
  return new PathReader(pathTokens(d), steps).read();
}

const polygonLength = (p: Point[]) => p.slice(1).reduce((sum, q, j) => sum + Math.hypot(q[0] - p[j][0], q[1] - p[j][1]), 0);

/** Walks path tokens, keeping the pen, the subpath's start and the last curve control point. */
class PathReader {
  private readonly outlines: Outline[] = [];
  private points: Point[] = [];
  private x = 0;
  private y = 0;
  private startX = 0;
  private startY = 0;
  private control: Point | null = null;
  private command = "";
  private i = 0;

  constructor(
    private readonly tokens: string[],
    private readonly steps: (length: number) => number,
  ) {}

  read(): Outline[] {
    while (this.i < this.tokens.length) {
      if (/[a-zA-Z]/.test(this.tokens[this.i])) this.command = this.tokens[this.i++];
      this.step();
    }
    this.flush(false);
    return this.outlines;
  }

  /** One command's arguments; a relative command's are offset by the pen. */
  private step(): void {
    const relative = this.command === this.command.toLowerCase();
    const ox = relative ? this.x : 0, oy = relative ? this.y : 0;
    switch (this.command.toUpperCase()) {
      case "M":
        this.move(ox, oy, relative);
        break;
      case "L":
        this.line(ox + this.next(), oy + this.next());
        this.control = null;
        break;
      case "H":
        this.line(ox + this.next(), this.y);
        this.control = null;
        break;
      case "V":
        this.line(this.x, oy + this.next());
        this.control = null;
        break;
      case "C":
        this.bezier([[this.x, this.y], this.pair(ox, oy), this.pair(ox, oy), this.pair(ox, oy)], 2);
        break;
      case "S":
        this.bezier([[this.x, this.y], this.reflection(), this.pair(ox, oy), this.pair(ox, oy)], 2);
        break;
      case "Q":
        this.bezier([[this.x, this.y], this.pair(ox, oy), this.pair(ox, oy)], 1);
        break;
      case "T":
        this.bezier([[this.x, this.y], this.reflection(), this.pair(ox, oy)], 1);
        break;
      case "A":
        this.arc(ox, oy);
        break;
      case "Z":
        this.x = this.startX;
        this.y = this.startY;
        this.flush(true);
        this.control = null;
        break;
      default:
        this.i++;
    }
  }

  private next(): number {
    return Number(this.tokens[this.i++]);
  }

  private pair(ox: number, oy: number): Point {
    return [ox + this.next(), oy + this.next()];
  }

  /** The last control point mirrored through the pen, which starts the smooth curves S and T. */
  private reflection(): Point {
    return this.control ? [2 * this.x - this.control[0], 2 * this.y - this.control[1]] : [this.x, this.y];
  }

  private flush(closed: boolean): void {
    if (this.points.length) this.outlines.push({ points: this.points, closed });
    this.points = [];
  }

  private move(ox: number, oy: number, relative: boolean): void {
    this.flush(false);
    this.x = ox + this.next();
    this.y = oy + this.next();
    this.startX = this.x;
    this.startY = this.y;
    this.points.push([this.x, this.y]);
    // Further pairs draw lines.
    this.command = relative ? "l" : "L";
    this.control = null;
  }

  private line(nx: number, ny: number): void {
    if (!this.points.length) this.points.push([this.x, this.y]);
    this.points.push([nx, ny]);
    this.x = nx;
    this.y = ny;
  }

  /** A Bézier curve on control polygon `p`; `p[control]` is the point a smooth curve reflects next. */
  private bezier(p: Point[], control: number): void {
    this.control = p[control];
    const n = this.steps(polygonLength(p));
    if (!this.points.length) this.points.push([this.x, this.y]);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      // De Casteljau on the control polygon.
      let layer = p;
      while (layer.length > 1) layer = layer.slice(1).map((q, j): Point => [layer[j][0] + (q[0] - layer[j][0]) * t, layer[j][1] + (q[1] - layer[j][1]) * t]);
      this.points.push(layer[0]);
    }
    [this.x, this.y] = p.at(-1)!;
  }

  private arc(ox: number, oy: number): void {
    const rx = Math.abs(this.next()), ry = Math.abs(this.next()), degrees = this.next(), large = this.next(), sweep = this.next();
    const to = this.pair(ox, oy);
    arc({ from: [this.x, this.y], to, rx, ry, degrees, large: !!large, sweep: !!sweep }, this.steps, (p) => {
      if (!this.points.length) this.points.push([this.x, this.y]);
      this.points.push(p);
    });
    [this.x, this.y] = to;
    this.control = null;
  }
}

/** An SVG endpoint arc: radii, x-axis rotation in degrees and the large-arc and sweep flags. */
type EndpointArc = { from: Point; to: Point; rx: number; ry: number; degrees: number; large: boolean; sweep: boolean };

/** Endpoint arc (SVG 1.1 F.6.5) to points, excluding the start. */
function arc(
  { from: [x1, y1], to: [x2, y2], rx: radiusX, ry: radiusY, degrees, large, sweep }: EndpointArc,
  steps: (length: number) => number,
  emit: (p: Point) => void,
): void {
  let rx = radiusX, ry = radiusY;
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return emit([x2, y2]);
  const phi = (degrees * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const px = cos * dx + sin * dy, py = -sin * dx + cos * dy;
  const lambda = (px * px) / (rx * rx) + (py * py) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
  const factor = sign * Math.sqrt(Math.max(0, numerator / (rx * rx * py * py + ry * ry * px * px)));
  const cxp = (factor * rx * py) / ry, cyp = (-factor * ry * px) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const start = angle(1, 0, (px - cxp) / rx, (py - cyp) / ry);
  let delta = angle((px - cxp) / rx, (py - cyp) / ry, (-px - cxp) / rx, (-py - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const n = steps(Math.abs(delta) * Math.max(rx, ry));
  for (let k = 1; k <= n; k++) {
    const t = start + (delta * k) / n;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    emit(k === n ? [x2, y2] : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
}
