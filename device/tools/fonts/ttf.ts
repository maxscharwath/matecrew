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
  private readonly view: DataView;
  private readonly tables: Tables = {};
  readonly unitsPerEm: number;
  private readonly numGlyphs: number;
  private readonly longLoca: boolean;
  private readonly metrics: number;
  private readonly cmap = new Map<number, number>();
  /** Normalised axis coordinates of the instance, by axis order. */
  private coords: number[] = [];
  private readonly axes: { tag: string; min: number; def: number; max: number }[] = [];

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = this.u16(4);
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16;
      const tag = String.fromCodePoint(...bytes.subarray(at, at + 4));
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
          tag: String.fromCodePoint(...bytes.subarray(at, at + 4)),
          min: this.fixed(at + 4),
          def: this.fixed(at + 8),
          max: this.fixed(at + 12),
        });
      }
      this.coords = this.axes.map(() => 0);
    }
  }

  private readonly u8 = (at: number) => this.view.getUint8(at);
  private readonly u16 = (at: number) => this.view.getUint16(at);
  private readonly i16 = (at: number) => this.view.getInt16(at);
  private readonly u32 = (at: number) => this.view.getUint32(at);
  private readonly fixed = (at: number) => this.view.getInt32(at) / 65536;
  private readonly f2dot14 = (at: number) => this.view.getInt16(at) / 16384;
  private at(tag: string) {
    return this.tables[tag].offset;
  }

  private readCmap() {
    const { at, format } = this.unicodeSubtable();
    if (format === 12) this.readCmap12(at);
    else this.readCmap4(at);
  }

  /** The Unicode subtable to read: format 12 (all planes) over format 4 (the BMP). */
  private unicodeSubtable(): { at: number; format: number } {
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
    return { at: best, format: bestFormat };
  }

  /** Format 12: groups of consecutive codes on consecutive glyphs. */
  private readCmap12(table: number) {
    const groups = this.u32(table + 12);
    for (let i = 0; i < groups; i++) {
      const at = table + 16 + i * 12;
      const [start, end, glyph] = [this.u32(at), this.u32(at + 4), this.u32(at + 8)];
      for (let c = start; c <= end; c++) this.cmap.set(c, glyph + c - start);
    }
  }

  /** Format 4: segments of codes, each mapped by a delta or through the glyph id array. */
  private readCmap4(table: number) {
    const segments = this.u16(table + 6) / 2;
    const ends = table + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    for (let s = 0; s < segments; s++) {
      const [start, end] = [this.u16(starts + s * 2), this.u16(ends + s * 2)];
      const delta = this.i16(deltas + s * 2);
      const range = this.u16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        const glyph = range === 0 ? (c + delta) & 0xffff : this.rangedGlyph(ranges + s * 2 + range + (c - start) * 2, delta);
        if (glyph) this.cmap.set(c, glyph);
      }
    }
  }

  /** A glyph from format 4's id array: 0 (missing) stays 0, the others take the segment's delta. */
  private rangedGlyph(at: number, delta: number): number {
    const glyph = this.u16(at);
    return glyph ? (glyph + delta) & 0xffff : 0;
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
    const [start, end] = this.glyphRange(glyph);
    if (end <= start) return { kind: "empty" };
    const at = this.at("glyf") + start;
    const contours = this.i16(at);
    const xMin = this.i16(at + 2);
    if (contours >= 0) return this.parseSimple(at + 10, contours, xMin);
    return { kind: "composite", components: this.parseComponents(at + 10, glyph), xMin };
  }

  /** The glyph's byte range in glyf, from loca. */
  private glyphRange(glyph: number): [number, number] {
    const loca = this.at("loca");
    return this.longLoca
      ? [this.u32(loca + glyph * 4), this.u32(loca + glyph * 4 + 4)]
      : [this.u16(loca + glyph * 2) * 2, this.u16(loca + glyph * 2 + 2) * 2];
  }

  /** A simple glyph's points, read from `from`, just past its header. */
  private parseSimple(from: number, contours: number, xMin: number): Parsed {
    let at = from;
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

  /** A composite glyph's components, read from `from`, just past its header. */
  private parseComponents(from: number, glyph: number): Component[] {
    const components: Component[] = [];
    let at = from;
    for (let more = true; more; ) {
      const flags = this.u16(at);
      const index = this.u16(at + 2);
      at += 4;
      // Bit 0: the offsets are words, not bytes.
      const words = (flags & 1) !== 0;
      const [dx, dy] = words ? [this.i16(at), this.i16(at + 2)] : [(this.u8(at) << 24) >> 24, (this.u8(at + 1) << 24) >> 24];
      at += words ? 4 : 2;
      if (!(flags & 2)) throw new Error(`glyph ${glyph}: components placed by point numbers are not supported`);
      const { matrix, size } = this.componentMatrix(flags, at);
      at += size;
      components.push({ glyph: index, dx, dy, matrix });
      more = (flags & 0x20) !== 0;
    }
    return components;
  }

  /** A component's transform (one scale with bit 3, x and y scales with bit 6, a 2 × 2 matrix with bit 7) and its size in bytes. */
  private componentMatrix(flags: number, at: number): { matrix: Component["matrix"]; size: number } {
    if (flags & 8) {
      const s = this.f2dot14(at);
      return { matrix: [s, 0, 0, s], size: 2 };
    }
    if (flags & 0x40) return { matrix: [this.f2dot14(at), 0, 0, this.f2dot14(at + 2)], size: 4 };
    if (flags & 0x80) return { matrix: [this.f2dot14(at), this.f2dot14(at + 2), this.f2dot14(at + 4), this.f2dot14(at + 6)], size: 8 };
    return { matrix: [1, 0, 0, 1], size: 0 };
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
    const variations = this.glyphVariations(glyph);
    if (!variations) return out;
    const { axisCount, sharedAt, data } = variations;
    const tupleCount = this.u16(data);
    // Serialized data: the shared point numbers, then each tuple's own points and deltas.
    const serial = { at: data + this.u16(data + 2) };
    const shared = tupleCount & 0x8000 ? this.packedPoints(serial) : null;
    let header = data + 4;
    for (let t = 0; t < (tupleCount & 0x0fff); t++) {
      const { size, index, peak, region, next } = this.tupleHeader(header, axisCount, sharedAt);
      header = next;
      const end = serial.at + size;
      const scalar = this.tupleScalar(peak, region);
      if (scalar) {
        const own = index & 0x2000 ? this.packedPoints(serial) : shared;
        const indices = own ?? points.map((_, i) => i);
        const dx = this.packedDeltas(serial, indices.length);
        const dy = this.packedDeltas(serial, indices.length);
        interpolate(points, ends, indices, dx, dy).forEach((d, i) => {
          if (!d) return;
          out[i].x += d.x * scalar;
          out[i].y += d.y * scalar;
        });
      }
      serial.at = end;
    }
    return out;
  }

  /** Where gvar keeps the glyph's variations; undefined when it has none or the instance is the default. */
  private glyphVariations(glyph: number): { axisCount: number; sharedAt: number; data: number } | undefined {
    if (!this.tables.gvar || this.coords.every((c) => c === 0)) return undefined;
    const gvar = this.at("gvar");
    const longOffsets = (this.u16(gvar + 14) & 1) === 1;
    const offset = (g: number) => (longOffsets ? this.u32(gvar + 20 + g * 4) : this.u16(gvar + 20 + g * 2) * 2);
    const [start, end] = [offset(glyph), offset(glyph + 1)];
    if (end <= start) return undefined;
    return { axisCount: this.u16(gvar + 4), sharedAt: gvar + this.u32(gvar + 8), data: gvar + this.u32(gvar + 16) + start };
  }

  /** The tuple variation header at `at`: its data size, flags, peak and intermediate region, and where the next one starts. */
  private tupleHeader(at: number, axisCount: number, sharedAt: number) {
    const tuple = (from: number) => Array.from({ length: axisCount }, (_, i) => this.f2dot14(from + i * 2));
    const size = this.u16(at);
    const index = this.u16(at + 2);
    let next = at + 4;
    // The peak is embedded (bit 15) or one of the shared tuples; an intermediate region (bit 14) follows.
    let peak: number[];
    if (index & 0x8000) {
      peak = tuple(next);
      next += axisCount * 2;
    } else peak = tuple(sharedAt + (index & 0x0fff) * axisCount * 2);
    let region: [number[], number[]] | undefined;
    if (index & 0x4000) {
      region = [tuple(next), tuple(next + axisCount * 2)];
      next += axisCount * 4;
    }
    return { size, index, peak, region, next };
  }

  /** How much of a tuple applies at the instance: the product of its axes' shares. */
  private tupleScalar(peak: number[], region: [number[], number[]] | undefined): number {
    let scalar = 1;
    for (let a = 0; a < peak.length && scalar; a++) {
      scalar *= axisScalar(this.coords[a], peak[a], region && [region[0][a], region[1][a]]);
    }
    return scalar;
  }

  /** Packed point numbers at `serial`, or null for all of the glyph's points. */
  private packedPoints(serial: { at: number }): number[] | null {
    let count = this.u8(serial.at++);
    if (count === 0) return null;
    if (count & 0x80) count = ((count & 0x7f) << 8) | this.u8(serial.at++);
    const list: number[] = [];
    let last = 0;
    while (list.length < count) {
      const control = this.u8(serial.at++);
      const words = (control & 0x80) !== 0;
      for (let run = (control & 0x7f) + 1; run > 0 && list.length < count; run--) {
        last += words ? this.u16(serial.at) : this.u8(serial.at);
        serial.at += words ? 2 : 1;
        list.push(last);
      }
    }
    return list;
  }

  /** `count` packed deltas at `serial`. */
  private packedDeltas(serial: { at: number }, count: number): number[] {
    const list: number[] = [];
    while (list.length < count) {
      const control = this.u8(serial.at++);
      const run = (control & 0x3f) + 1;
      for (let i = 0; i < run && list.length < count; i++) list.push(this.packedDelta(serial, control));
    }
    return list;
  }

  /** One delta of a run: 32-bit (both top bits of `control`), zero (bit 7), 16-bit (bit 6) or a byte. */
  private packedDelta(serial: { at: number }, control: number): number {
    if ((control & 0xc0) === 0xc0) {
      const value = this.view.getInt32(serial.at);
      serial.at += 4;
      return value;
    }
    if (control & 0x80) return 0;
    if (control & 0x40) {
      const value = this.i16(serial.at);
      serial.at += 2;
      return value;
    }
    return (this.u8(serial.at++) << 24) >> 24;
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
 * One axis's share of a tuple at instance coordinate `v`: 1 at the peak `p`, fading to 0 at the
 * default or at the edges of the intermediate `region`.
 */
function axisScalar(v: number, p: number, region: [number, number] | undefined): number {
  if (p === 0) return 1;
  if (v === 0) return 0;
  if (region) {
    const [lower, upper] = region;
    if (v < lower || v > upper) return 0;
    if (v < p) return (v - lower) / (p - lower);
    return v > p ? (upper - v) / (upper - p) : 1;
  }
  if (v < Math.min(0, p) || v > Math.max(0, p)) return 0;
  return v / p;
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
    interpolateContour(points, out, named, contour);
  }
  return out;
}

/** The untouched points of one contour, between the named points on either side of each. */
function interpolateContour(
  points: { x: number; y: number }[],
  out: ({ x: number; y: number } | undefined)[],
  named: boolean[],
  contour: number[],
) {
  const touched = contour.filter((p) => named[p]);
  if (!touched.length) return;
  if (touched.length === 1) {
    for (const p of contour) out[p] ??= { ...out[touched[0]]! };
    return;
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
