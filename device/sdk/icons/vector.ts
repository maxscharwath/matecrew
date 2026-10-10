/**
 * Vector art to packed 1-bit sprites, at compile time. Pure TypeScript and deterministic, so a
 * build gives the same bits on every machine (`dui check` compares them).
 *
 * Strokes keep an exact pixel width with round caps and joins; fills support non-zero and
 * even-odd rules and an ordered-dither tone for greys. Every pixel is sampled 4 × 4 and inked
 * when at least half of its samples are covered.
 */

/** Lucide's element list: `[tag, attributes]`. */
export type VectorNode = [string, Record<string, string | number | undefined>];
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
  for (const layer of layers) {
    const outlines = layer.nodes.flatMap((node) => outlinesOf(node, scale)).map((outline) => ({
      closed: outline.closed,
      points: outline.points.map(([x, y]): Point => [x * scale + dx, y * scale + dy]),
    }));
    const tone = Math.max(0, Math.min(100, layer.tone ?? 100));
    const coverage = new Uint8Array(width * height * SAMPLES * SAMPLES);
    const W = width * SAMPLES;
    if (layer.fill) fillSamples(coverage, W, height * SAMPLES, outlines.map((o) => o.points), layer.rule ?? "nonzero");
    if (layer.stroke) for (const outline of outlines) strokeSamples(coverage, W, height * SAMPLES, outline.points, outline.closed, layer.stroke / 2);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let covered = 0;
        for (let j = 0; j < SAMPLES; j++)
          for (let i = 0; i < SAMPLES; i++) covered += coverage[(y * SAMPLES + j) * W + x * SAMPLES + i];
        if (covered * 2 < SAMPLES * SAMPLES) continue;
        // Ordered dither: a 50 % tone inks every other pixel, 25 % one in four.
        ink[y * width + x] = BAYER[y & 3][x & 3] * 100 + 50 < tone * 16 ? 1 : 0;
      }
  }
  const bits = new Array<number>(Math.ceil((width * height) / 8)).fill(0);
  ink.forEach((on, i) => {
    if (on) bits[i >> 3] |= 128 >> (i & 7);
  });
  return { width, height, bits };
}

function strokeSamples(out: Uint8Array, W: number, H: number, points: Point[], closed: boolean, radius: number): void {
  const segments: [Point, Point][] = [];
  for (let i = 1; i < points.length; i++) segments.push([points[i - 1], points[i]]);
  if (closed && points.length > 2) segments.push([points[points.length - 1], points[0]]);
  if (points.length === 1) segments.push([points[0], points[0]]);
  const r = radius * SAMPLES;
  for (const [a, b] of segments) {
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
}

function fillSamples(out: Uint8Array, W: number, H: number, polygons: Point[][], rule: "nonzero" | "evenodd"): void {
  const edges: [number, number, number, number][] = [];
  for (const polygon of polygons)
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if (a[1] !== b[1]) edges.push([a[0] * SAMPLES, a[1] * SAMPLES, b[0] * SAMPLES, b[1] * SAMPLES]);
    }
  for (let y = 0; y < H; y++) {
    const cy = y + 0.5;
    const crossings: [number, number][] = [];
    for (const [ax, ay, bx, by] of edges)
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) crossings.push([ax + ((cy - ay) / (by - ay)) * (bx - ax), by > ay ? 1 : -1]);
    crossings.sort((p, q) => p[0] - q[0]);
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
const number = (value: string | number | undefined, fallback = 0) => (value === undefined ? fallback : Number(value));

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
  for (const [, name, args] of list.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
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
    case "polygon": {
      const values = String(a.points ?? "").trim().split(/[\s,]+/).map(Number);
      const points: Point[] = [];
      for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i], values[i + 1]]);
      return [{ points, closed: tag === "polygon" }];
    }
    case "circle":
    case "ellipse": {
      const rx = number(tag === "circle" ? a.r : a.rx), ry = number(tag === "circle" ? a.r : a.ry);
      const cx = number(a.cx), cy = number(a.cy);
      const n = steps(2 * Math.PI * Math.max(rx, ry));
      const points: Point[] = [];
      for (let i = 0; i < n; i++) points.push([cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)]);
      return [{ points, closed: true }];
    }
    case "rect": {
      const x = number(a.x), y = number(a.y), w = number(a.width), h = number(a.height);
      let rx = number(a.rx ?? a.ry), ry = number(a.ry ?? a.rx);
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx || !ry) return [{ points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }];
      return pathOutlines(
        `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
        steps,
      );
    }
    default:
      return [];
  }
}

/** SVG path data, every command, to polylines. */
export function pathOutlines(d: string, steps: (length: number) => number = (l) => Math.max(4, Math.ceil(l * 2))): Outline[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const outlines: Outline[] = [];
  let points: Point[] = [];
  let x = 0, y = 0, startX = 0, startY = 0;
  let control: Point | null = null;
  let command = "";
  let i = 0;
  const next = () => Number(tokens[i++]);
  const flush = (closed: boolean) => {
    if (points.length) outlines.push({ points, closed });
    points = [];
  };
  const line = (nx: number, ny: number) => {
    if (!points.length) points.push([x, y]);
    points.push([nx, ny]);
    x = nx;
    y = ny;
  };
  const curve = (p: Point[], length: number) => {
    const n = steps(length);
    if (!points.length) points.push([x, y]);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      // De Casteljau on the control polygon.
      let layer = p;
      while (layer.length > 1) layer = layer.slice(1).map((q, j): Point => [layer[j][0] + (q[0] - layer[j][0]) * t, layer[j][1] + (q[1] - layer[j][1]) * t]);
      points.push(layer[0]);
    }
    [x, y] = p[p.length - 1];
  };
  const polygonLength = (p: Point[]) => p.slice(1).reduce((sum, q, j) => sum + Math.hypot(q[0] - p[j][0], q[1] - p[j][1]), 0);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0, oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M": {
        flush(false);
        x = ox + next();
        y = oy + next();
        startX = x;
        startY = y;
        points.push([x, y]);
        command = relative ? "l" : "L";
        control = null;
        break;
      }
      case "L":
        line(ox + next(), oy + next());
        control = null;
        break;
      case "H":
        line((relative ? x : 0) + next(), y);
        control = null;
        break;
      case "V":
        line(x, (relative ? y : 0) + next());
        control = null;
        break;
      case "C": {
        const p: Point[] = [[x, y], [ox + next(), oy + next()], [ox + next(), oy + next()], [ox + next(), oy + next()]];
        control = p[2];
        curve(p, polygonLength(p));
        break;
      }
      case "S": {
        const first: Point = control ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
        const p: Point[] = [[x, y], first, [ox + next(), oy + next()], [ox + next(), oy + next()]];
        control = p[2];
        curve(p, polygonLength(p));
        break;
      }
      case "Q": {
        const p: Point[] = [[x, y], [ox + next(), oy + next()], [ox + next(), oy + next()]];
        control = p[1];
        curve(p, polygonLength(p));
        break;
      }
      case "T": {
        const c: Point = control ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
        const p: Point[] = [[x, y], c, [ox + next(), oy + next()]];
        control = c;
        curve(p, polygonLength(p));
        break;
      }
      case "A": {
        const rx = Math.abs(next()), ry = Math.abs(next()), rotation = next(), large = next(), sweep = next();
        const ex = ox + next(), ey = oy + next();
        arc(x, y, rx, ry, rotation, !!large, !!sweep, ex, ey, steps, (p) => {
          if (!points.length) points.push([x, y]);
          points.push(p);
        });
        x = ex;
        y = ey;
        control = null;
        break;
      }
      case "Z":
        x = startX;
        y = startY;
        flush(true);
        control = null;
        break;
      default:
        i++;
    }
  }
  flush(false);
  return outlines;
}

/** Endpoint arc (SVG 1.1 F.6.5) to points, excluding the start. */
function arc(
  x1: number, y1: number, rx: number, ry: number, degrees: number, large: boolean, sweep: boolean,
  x2: number, y2: number, steps: (length: number) => number, emit: (p: Point) => void,
): void {
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
