/**
 * Just enough TrueType to draw a variable font at one instance: cmap, hmtx, glyf (simple and
 * composite glyphs) and the variations a `wght` axis needs (fvar, avar, gvar with its point
 * interpolation). Outlines come out in font units, y up, contours of quadratic segments.
 * https://learn.microsoft.com/typography/opentype/spec/
 */

export type Point = { x: number; y: number; on: boolean };
export type Outline = { contours: Point[][]; advance: number };

type Tables = Record<string, { offset: number; length: number }>;
type Component = { glyph: number; dx: number; dy: number; matrix: [number, number, number, number] };
type Parsed =
  | { kind: "empty" }
  | { kind: "simple"; points: Point[]; ends: number[]; xMin: number }
  | { kind: "composite"; components: Component[]; xMin: number };

export class Font {
  private view: DataView;
  private tables: Tables = {};
  readonly unitsPerEm: number;
  private numGlyphs: number;
  private longLoca: boolean;
  private metrics: number;
  private cmap = new Map<number, number>();
  /** Normalised axis coordinates of the instance, by axis order. */
  private coords: number[] = [];
  private axes: { tag: string; min: number; def: number; max: number }[] = [];

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = this.u16(4);
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16;
      const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
      this.tables[tag] = { offset: this.u32(at + 8), length: this.u32(at + 12) };
    }
    for (const tag of ["head", "maxp", "hhea", "hmtx", "cmap", "loca", "glyf"]) {
      if (!this.tables[tag]) throw new Error(`no ${tag} table`);
    }
    this.unitsPerEm = this.u16(this.at("head") + 18);
    this.longLoca = this.i16(this.at("head") + 50) === 1;
    this.numGlyphs = this.u16(this.at("maxp") + 4);
    this.metrics = this.u16(this.at("hhea") + 34);
    this.readCmap();
    if (this.tables.fvar) {
      const fvar = this.at("fvar");
      const axesAt = fvar + this.u16(fvar + 4);
      const axisCount = this.u16(fvar + 8);
      const axisSize = this.u16(fvar + 10);
      for (let i = 0; i < axisCount; i++) {
        const at = axesAt + i * axisSize;
        this.axes.push({
          tag: String.fromCharCode(...bytes.subarray(at, at + 4)),
          min: this.fixed(at + 4),
          def: this.fixed(at + 8),
          max: this.fixed(at + 12),
        });
      }
      this.coords = this.axes.map(() => 0);
    }
  }

  private u8 = (at: number) => this.view.getUint8(at);
  private u16 = (at: number) => this.view.getUint16(at);
  private i16 = (at: number) => this.view.getInt16(at);
  private u32 = (at: number) => this.view.getUint32(at);
  private fixed = (at: number) => this.view.getInt32(at) / 65536;
  private f2dot14 = (at: number) => this.view.getInt16(at) / 16384;
  private at(tag: string) {
    return this.tables[tag].offset;
  }

  private readCmap() {
    const cmap = this.at("cmap");
    const count = this.u16(cmap + 2);
    let best = -1;
    let bestFormat = 0;
    for (let i = 0; i < count; i++) {
      const platform = this.u16(cmap + 4 + i * 8);
      const encoding = this.u16(cmap + 6 + i * 8);
      const at = cmap + this.u32(cmap + 8 + i * 8);
      const format = this.u16(at);
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
      if (unicode && (format === 12 || (format === 4 && bestFormat !== 12))) {
        best = at;
        bestFormat = format;
      }
    }
    if (best < 0) throw new Error("no Unicode cmap");
    if (bestFormat === 12) {
      const groups = this.u32(best + 12);
      for (let i = 0; i < groups; i++) {
        const at = best + 16 + i * 12;
        const [start, end, glyph] = [this.u32(at), this.u32(at + 4), this.u32(at + 8)];
        for (let c = start; c <= end; c++) this.cmap.set(c, glyph + c - start);
      }
      return;
    }
    const segments = this.u16(best + 6) / 2;
    const ends = best + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    for (let s = 0; s < segments; s++) {
      const [start, end] = [this.u16(starts + s * 2), this.u16(ends + s * 2)];
      const delta = this.i16(deltas + s * 2);
      const range = this.u16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph = 0;
        if (range === 0) glyph = (c + delta) & 0xffff;
        else {
          const at = ranges + s * 2 + range + (c - start) * 2;
          glyph = this.u16(at);
          if (glyph) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph) this.cmap.set(c, glyph);
      }
    }
  }

  /** Picks the instance, in user units (`{ wght: 700 }`), through avar's mapping. */
  setVariation(values: Record<string, number>) {
    this.coords = this.axes.map((axis) => {
      const value = Math.min(axis.max, Math.max(axis.min, values[axis.tag] ?? axis.def));
      if (value < axis.def) return (value - axis.def) / (axis.def - axis.min);
      if (value > axis.def) return (value - axis.def) / (axis.max - axis.def);
      return 0;
    });
    if (this.tables.avar) {
      let at = this.at("avar") + 8;
      this.coords = this.coords.map((v) => {
        const count = this.u16(at);
        const map: [number, number][] = [];
        for (let i = 0; i < count; i++) map.push([this.f2dot14(at + 2 + i * 4), this.f2dot14(at + 4 + i * 4)]);
        at += 2 + count * 4;
        for (let i = 1; i < map.length; i++) {
          if (v <= map[i][0]) {
            const [[x0, y0], [x1, y1]] = [map[i - 1], map[i]];
            return x1 === x0 ? y1 : y0 + ((v - x0) * (y1 - y0)) / (x1 - x0);
          }
        }
        return v;
      });
    }
  }

  glyphOf(code: number): number | undefined {
    return this.cmap.get(code);
  }

  private parse(glyph: number): Parsed {
    const loca = this.at("loca");
    const [start, end] = this.longLoca
      ? [this.u32(loca + glyph * 4), this.u32(loca + glyph * 4 + 4)]
      : [this.u16(loca + glyph * 2) * 2, this.u16(loca + glyph * 2 + 2) * 2];
    if (end <= start) return { kind: "empty" };
    let at = this.at("glyf") + start;
    const contours = this.i16(at);
    const xMin = this.i16(at + 2);
    at += 10;
    if (contours >= 0) {
      const ends: number[] = [];
      for (let i = 0; i < contours; i++) ends.push(this.u16(at + i * 2));
      at += contours * 2;
      at += 2 + this.u16(at);
      const count = contours ? ends[contours - 1] + 1 : 0;
      const flags: number[] = [];
      while (flags.length < count) {
        const flag = this.u8(at++);
        flags.push(flag);
        if (flag & 8) for (let r = this.u8(at++); r > 0; r--) flags.push(flag);
      }
      const coordinates = (short: number, same: number) => {
        const out: number[] = [];
        let value = 0;
        for (const flag of flags) {
          if (flag & short) value += flag & same ? this.u8(at++) : -this.u8(at++);
          else if (!(flag & same)) {
            value += this.i16(at);
            at += 2;
          }
          out.push(value);
        }
        return out;
      };
      const xs = coordinates(2, 16);
      const ys = coordinates(4, 32);
      return { kind: "simple", points: flags.map((flag, i) => ({ x: xs[i], y: ys[i], on: (flag & 1) === 1 })), ends, xMin };
    }
    const components: Component[] = [];
    for (let more = true; more; ) {
      const flags = this.u16(at);
      const index = this.u16(at + 2);
      at += 4;
      let dx: number, dy: number;
      if (flags & 1) {
        [dx, dy] = [this.i16(at), this.i16(at + 2)];
        at += 4;
      } else {
        [dx, dy] = [(this.u8(at) << 24) >> 24, (this.u8(at + 1) << 24) >> 24];
        at += 2;
      }
      if (!(flags & 2)) throw new Error(`glyph ${glyph}: components placed by point numbers are not supported`);
      let matrix: Component["matrix"] = [1, 0, 0, 1];
      if (flags & 8) {
        const s = this.f2dot14(at);
        matrix = [s, 0, 0, s];
        at += 2;
      } else if (flags & 0x40) {
        matrix = [this.f2dot14(at), 0, 0, this.f2dot14(at + 2)];
        at += 4;
      } else if (flags & 0x80) {
        matrix = [this.f2dot14(at), this.f2dot14(at + 2), this.f2dot14(at + 4), this.f2dot14(at + 6)];
        at += 8;
      }
      components.push({ glyph: index, dx, dy, matrix });
      more = (flags & 0x20) !== 0;
    }
    return { kind: "composite", components, xMin };
  }

  private advanceOf(glyph: number): [number, number] {
    const hmtx = this.at("hmtx");
    const i = Math.min(glyph, this.metrics - 1);
    const advance = this.u16(hmtx + i * 4);
    const lsb = glyph < this.metrics ? this.i16(hmtx + glyph * 4 + 2) : this.i16(hmtx + this.metrics * 4 + (glyph - this.metrics) * 2);
    return [advance, lsb];
  }

  /** Summed gvar deltas for each of `points` (outline points or component offsets, then the four phantom points). */
  private deltas(glyph: number, points: { x: number; y: number }[], ends: number[]): { x: number; y: number }[] {
    const out = points.map(() => ({ x: 0, y: 0 }));
    if (!this.tables.gvar || this.coords.every((c) => c === 0)) return out;
    const gvar = this.at("gvar");
    const axisCount = this.u16(gvar + 4);
    const sharedCount = this.u16(gvar + 6);
    const sharedAt = gvar + this.u32(gvar + 8);
    const longOffsets = (this.u16(gvar + 14) & 1) === 1;
    const arrayAt = gvar + this.u32(gvar + 16);
    const offset = (g: number) => (longOffsets ? this.u32(gvar + 20 + g * 4) : this.u16(gvar + 20 + g * 2) * 2);
    const [start, end] = [offset(glyph), offset(glyph + 1)];
    if (end <= start) return out;
    const data = arrayAt + start;
    const tupleCount = this.u16(data);
    let serial = data + this.u16(data + 2);
    let header = data + 4;
    const tuple = (at: number) => Array.from({ length: axisCount }, (_, i) => this.f2dot14(at + i * 2));
    const readPoints = (): number[] | null => {
      let count = this.u8(serial++);
      if (count === 0) return null;
      if (count & 0x80) count = ((count & 0x7f) << 8) | this.u8(serial++);
      const list: number[] = [];
      let last = 0;
      while (list.length < count) {
        const control = this.u8(serial++);
        const words = (control & 0x80) !== 0;
        for (let run = (control & 0x7f) + 1; run > 0 && list.length < count; run--) {
          last += words ? this.u16(serial) : this.u8(serial);
          serial += words ? 2 : 1;
          list.push(last);
        }
      }
      return list;
    };
    const readDeltas = (count: number) => {
      const list: number[] = [];
      while (list.length < count) {
        const control = this.u8(serial++);
        const run = (control & 0x3f) + 1;
        for (let i = 0; i < run && list.length < count; i++) {
          if ((control & 0xc0) === 0xc0) {
            list.push(this.view.getInt32(serial));
            serial += 4;
          } else if (control & 0x80) list.push(0);
          else if (control & 0x40) {
            list.push(this.i16(serial));
            serial += 2;
          } else list.push((this.u8(serial++) << 24) >> 24);
        }
      }
      return list;
    };
    const shared = tupleCount & 0x8000 ? readPoints() : null;
    for (let t = 0; t < (tupleCount & 0x0fff); t++) {
      const size = this.u16(header);
      const index = this.u16(header + 2);
      header += 4;
      let peak: number[];
      if (index & 0x8000) {
        peak = tuple(header);
        header += axisCount * 2;
      } else peak = tuple(sharedAt + (index & 0x0fff) * axisCount * 2);
      void sharedCount;
      let lower: number[] | undefined, upper: number[] | undefined;
      if (index & 0x4000) {
        lower = tuple(header);
        upper = tuple(header + axisCount * 2);
        header += axisCount * 4;
      }
      const next = serial + size;
      let scalar = 1;
      for (let a = 0; a < axisCount && scalar; a++) {
        const [v, p] = [this.coords[a], peak[a]];
        if (p === 0) continue;
        if (v === 0) scalar = 0;
        else if (lower && upper) {
          if (v < lower[a] || v > upper[a]) scalar = 0;
          else if (v < p) scalar *= (v - lower[a]) / (p - lower[a]);
          else if (v > p) scalar *= (upper[a] - v) / (upper[a] - p);
        } else if (v < Math.min(0, p) || v > Math.max(0, p)) scalar = 0;
        else scalar *= v / p;
      }
      if (scalar) {
        const own = index & 0x2000 ? readPoints() : shared;
        const indices = own ?? points.map((_, i) => i);
        const dx = readDeltas(indices.length);
        const dy = readDeltas(indices.length);
        const tupleDeltas = interpolate(points, ends, indices, dx, dy);
        tupleDeltas.forEach((d, i) => {
          if (!d) return;
          out[i].x += d.x * scalar;
          out[i].y += d.y * scalar;
        });
      }
      serial = next;
    }
    return out;
  }

  /** The glyph's contours and advance at the current instance, in font units. */
  outline(glyph: number): Outline {
    const parsed = this.parse(glyph);
    const [advance, lsb] = this.advanceOf(glyph);
    const xMin = parsed.kind === "empty" ? 0 : parsed.xMin;
    const phantom = [
      { x: xMin - lsb, y: 0 },
      { x: xMin - lsb + advance, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    if (parsed.kind === "simple") {
      const d = this.deltas(glyph, [...parsed.points, ...phantom], parsed.ends);
      const moved = parsed.points.map((p, i) => ({ x: p.x + d[i].x, y: p.y + d[i].y, on: p.on }));
      const contours: Point[][] = [];
      let from = 0;
      for (const end of parsed.ends) {
        contours.push(moved.slice(from, end + 1));
        from = end + 1;
      }
      const n = parsed.points.length;
      return { contours, advance: phantom[1].x + d[n + 1].x - (phantom[0].x + d[n].x) };
    }
    if (parsed.kind === "composite") {
      const anchors = parsed.components.map((c) => ({ x: c.dx, y: c.dy }));
      const d = this.deltas(glyph, [...anchors, ...phantom], []);
      const contours: Point[][] = [];
      parsed.components.forEach((c, i) => {
        const [a, b, cc, dd] = c.matrix;
        const [dx, dy] = [c.dx + d[i].x, c.dy + d[i].y];
        for (const contour of this.outline(c.glyph).contours) {
          contours.push(contour.map((p) => ({ x: a * p.x + cc * p.y + dx, y: b * p.x + dd * p.y + dy, on: p.on })));
        }
      });
      const n = anchors.length;
      return { contours, advance: phantom[1].x + d[n + 1].x - (phantom[0].x + d[n].x) };
    }
    const d = this.deltas(glyph, phantom, []);
    return { contours: [], advance: phantom[1].x + d[1].x - (phantom[0].x + d[0].x) };
  }
}

/**
 * Deltas for every point from the ones a tuple names: points it leaves out take theirs from the
 * named neighbours on the same contour (gvar's "interpolate untouched points").
 */
function interpolate(points: { x: number; y: number }[], ends: number[], indices: number[], dx: number[], dy: number[]) {
  const out: ({ x: number; y: number } | undefined)[] = points.map(() => undefined);
  indices.forEach((p, i) => {
    if (p < points.length) out[p] = { x: (out[p]?.x ?? 0) + dx[i], y: (out[p]?.y ?? 0) + dy[i] };
  });
  if (indices.length === points.length) return out;
  const named = out.map(Boolean);
  let from = 0;
  for (const end of ends) {
    const contour = Array.from({ length: end - from + 1 }, (_, k) => from + k);
    from = end + 1;
    const touched = contour.filter((p) => named[p]);
    if (!touched.length) continue;
    if (touched.length === 1) {
      for (const p of contour) out[p] ??= { ...out[touched[0]]! };
      continue;
    }
    const n = contour.length;
    for (let k = 0; k < n; k++) {
      const p = contour[k];
      if (named[p]) continue;
      let before = k;
      while (!named[contour[before]]) before = (before - 1 + n) % n;
      let after = k;
      while (!named[contour[after]]) after = (after + 1) % n;
      const [a, b] = [contour[before], contour[after]];
      const axis = (key: "x" | "y") => {
        const [ca, cb, v] = [points[a][key], points[b][key], points[p][key]];
        const [da, db] = [out[a]![key], out[b]![key]];
        if (ca === cb) return da === db ? da : 0;
        const [lo, hi, dlo, dhi] = ca < cb ? [ca, cb, da, db] : [cb, ca, db, da];
        if (v <= lo) return dlo;
        if (v >= hi) return dhi;
        return dlo + ((v - lo) * (dhi - dlo)) / (hi - lo);
      };
      out[p] = { x: axis("x"), y: axis("y") };
    }
  }
  return out;
}
