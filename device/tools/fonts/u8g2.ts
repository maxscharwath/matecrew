/**
 * The u8g2 font format (`.u8g2font`, as `u8g2-fonts` reads it), written the way u8g2's
 * `bdfconv` does: a 23-byte header, glyphs below U+0100 by code, then a jump table and the
 * other glyphs. Each glyph is its box (width, height, x and y offsets, advance) and its pixels,
 * row by row from the top, as alternating runs of paper and ink.
 * https://github.com/olikraus/u8g2/wiki/u8g2fontformat
 */

/** One glyph: `bits` holds `width × height` pixels, 1 for ink, top row first. */
export type Glyph = {
  code: number;
  width: number;
  height: number;
  /** Left edge from the pen position. */
  x: number;
  /** Bottom edge above the baseline (negative for descenders). */
  y: number;
  advance: number;
  bits: Uint8Array;
};

/** Header metrics: the font box, then the reference glyphs' extents. */
export type Header = {
  glyphs: number;
  box: { width: number; height: number; x: number; y: number };
  ascentA: number;
  descentG: number;
  ascentParen: number;
  descentParen: number;
};

class BitWriter {
  readonly bytes: number[] = [];
  private bit = 0;
  /** Least significant bit first, as the reader expects. */
  put(value: number, bits: number) {
    for (let i = 0; i < bits; i++) {
      if (this.bit === 0) this.bytes.push(0);
      if ((value >> i) & 1) this.bytes[this.bytes.length - 1] |= 1 << this.bit;
      this.bit = (this.bit + 1) & 7;
    }
  }
}

class BitReader {
  private bit = 0;
  constructor(private readonly data: Uint8Array, private at: number) {}
  get(bits: number) {
    let value = 0;
    for (let i = 0; i < bits; i++) {
      value |= ((this.data[this.at] >> this.bit) & 1) << i;
      if (++this.bit === 8) {
        this.bit = 0;
        this.at++;
      }
    }
    return value;
  }
  signed(bits: number) {
    return this.get(bits) - (1 << (bits - 1));
  }
}

/** Bits for an unsigned value, or a signed range stored with a bias of half the span. */
const unsignedBits = (max: number) => Math.max(1, Math.ceil(Math.log2(max + 1)));
const signedBits = (min: number, max: number) => {
  let bits = 1;
  while (min < -(1 << (bits - 1)) || max > (1 << (bits - 1)) - 1) bits++;
  return bits;
};

type Bits = { w: number; h: number; x: number; y: number; d: number };

/** The pixels as (paper, ink) run pairs; a pair equal to the one before costs one bit. */
function runs(glyph: Glyph, m0: number, m1: number): [number, number][] {
  const max0 = (1 << m0) - 1;
  const max1 = (1 << m1) - 1;
  const pairs: [number, number][] = [];
  const pair = (zeros: number, ones: number) => {
    while (zeros > max0) {
      pairs.push([max0, 0]);
      zeros -= max0;
    }
    while (ones > max1) {
      pairs.push([zeros, max1]);
      zeros = 0;
      ones -= max1;
    }
    pairs.push([zeros, ones]);
  };
  let zeros = 0;
  let ones = 0;
  for (const bit of glyph.bits) {
    if (bit) ones++;
    else {
      if (ones) {
        pair(zeros, ones);
        zeros = 0;
        ones = 0;
      }
      zeros++;
    }
  }
  if (zeros || ones) pair(zeros, ones);
  return pairs;
}

function glyphBits(glyph: Glyph, bits: Bits, m0: number, m1: number): number[] {
  const out = new BitWriter();
  out.put(glyph.width, bits.w);
  out.put(glyph.height, bits.h);
  out.put(glyph.x + (1 << (bits.x - 1)), bits.x);
  out.put(glyph.y + (1 << (bits.y - 1)), bits.y);
  out.put(glyph.advance + (1 << (bits.d - 1)), bits.d);
  if (glyph.width && glyph.height) {
    let last: [number, number] | undefined;
    for (const [zeros, ones] of runs(glyph, m0, m1)) {
      if (last?.[0] === zeros && last[1] === ones) {
        out.put(1, 1);
        continue;
      }
      if (last) out.put(0, 1);
      out.put(zeros, m0);
      out.put(ones, m1);
      last = [zeros, ones];
    }
    // Ends the last run's repeats.
    out.put(0, 1);
  }
  return out.bytes;
}

/**
 * Encodes glyphs sorted by code. `box` replaces the font box computed from the glyphs, so a
 * font can keep the line metrics of the one it replaces.
 */
export function encode(glyphs: Glyph[], box?: Header["box"]): Uint8Array {
  glyphs = [...glyphs].sort((a, b) => a.code - b.code);
  const bits = fieldBits(glyphs);
  const { m0, m1 } = runLengths(glyphs, bits);
  box ??= inkBox(glyphs.filter((g) => g.width && g.height));
  const find = (code: number) => glyphs.find((g) => g.code === code);
  const top = (code: number) => (find(code) ? find(code)!.y + find(code)!.height : 0);
  const bottom = (code: number) => find(code)?.y ?? 0;

  const glyphData = (glyph: Glyph) => glyphBits(glyph, bits, m0, m1);
  const body: number[] = [];
  const { upperA, lowerA } = latinGlyphs(body, glyphs.filter((g) => g.code < 0x100), glyphData);
  // One jump table entry covers every glyph above U+00FF: a short linear search.
  const unicode = body.length;
  body.push(0, 4, 0xff, 0xff);
  otherGlyphs(body, glyphs.filter((g) => g.code >= 0x100), glyphData);

  const s8 = (n: number) => n & 0xff;
  const header = [
    glyphs.length & 0xff,
    0,
    m0,
    m1,
    bits.w,
    bits.h,
    bits.x,
    bits.y,
    bits.d,
    box.width,
    box.height,
    s8(box.x),
    s8(box.y),
    s8(top(0x41)),
    s8(bottom(0x67)),
    s8(top(0x28)),
    s8(bottom(0x29)),
    upperA >> 8,
    upperA & 0xff,
    lowerA >> 8,
    lowerA & 0xff,
    unicode >> 8,
    unicode & 0xff,
  ];
  return Uint8Array.from([...header, ...body]);
}

/** Bits for each glyph box field, from the widest value any glyph needs. */
function fieldBits(glyphs: Glyph[]): Bits {
  const bits: Bits = {
    w: unsignedBits(Math.max(...glyphs.map((g) => g.width))),
    h: unsignedBits(Math.max(...glyphs.map((g) => g.height))),
    x: signedBits(Math.min(...glyphs.map((g) => g.x)), Math.max(...glyphs.map((g) => g.x))),
    y: signedBits(Math.min(...glyphs.map((g) => g.y)), Math.max(...glyphs.map((g) => g.y))),
    d: signedBits(Math.min(...glyphs.map((g) => g.advance)), Math.max(...glyphs.map((g) => g.advance))),
  };
  if (Object.values(bits).some((n) => n > 8)) throw new Error(`field too wide for u8g2: ${JSON.stringify(bits)}`);
  return bits;
}

/** The run lengths bdfconv would pick: the smallest font over every pair of widths. */
function runLengths(glyphs: Glyph[], bits: Bits): { m0: number; m1: number } {
  let best: { size: number; m0: number; m1: number } | undefined;
  for (let m0 = 2; m0 <= 8; m0++) {
    for (let m1 = 2; m1 <= 8; m1++) {
      const size = glyphs.reduce((sum, g) => sum + glyphBits(g, bits, m0, m1).length, 0);
      if (!best || size < best.size) best = { size, m0, m1 };
    }
  }
  return best!;
}

/** The box around every inked glyph. */
function inkBox(inked: Glyph[]): Header["box"] {
  const left = Math.min(...inked.map((g) => g.x));
  const right = Math.max(...inked.map((g) => g.x + g.width));
  const bottom = Math.min(...inked.map((g) => g.y));
  const top = Math.max(...inked.map((g) => g.y + g.height));
  return { width: right - left, height: top - bottom, x: left, y: bottom };
}

/** Glyphs below U+0100 by code, then the end mark; returns where the glyphs from "A" and from "a" start. */
function latinGlyphs(body: number[], glyphs: Glyph[], glyphData: (glyph: Glyph) => number[]) {
  let upperA = -1;
  let lowerA = -1;
  for (const glyph of glyphs) {
    if (upperA < 0 && glyph.code >= 0x41) upperA = body.length;
    if (lowerA < 0 && glyph.code >= 0x61) lowerA = body.length;
    const data = glyphData(glyph);
    if (data.length + 2 > 255) throw new Error(`glyph U+${glyph.code.toString(16)} takes ${data.length + 2} bytes`);
    body.push(glyph.code, data.length + 2, ...data);
  }
  if (upperA < 0) upperA = body.length;
  if (lowerA < 0) lowerA = body.length;
  body.push(0, 0);
  return { upperA, lowerA };
}

/** Glyphs from U+0100 on, by two-byte code, then the end mark. */
function otherGlyphs(body: number[], glyphs: Glyph[], glyphData: (glyph: Glyph) => number[]): void {
  for (const glyph of glyphs) {
    const data = glyphData(glyph);
    if (data.length + 3 > 255) throw new Error(`glyph U+${glyph.code.toString(16)} takes ${data.length + 3} bytes`);
    body.push(glyph.code >> 8, glyph.code & 0xff, data.length + 3, ...data);
  }
  body.push(0, 0);
}

/** Reads a font back, glyph by glyph: to check the encoder and to measure existing fonts. */
export function decode(data: Uint8Array): { header: Header; glyphs: Glyph[] } {
  const i8 = (n: number) => (n << 24) >> 24;
  const [m0, m1, bw, bh, bx, by, bd] = [data[2], data[3], data[4], data[5], data[6], data[7], data[8]];
  const header: Header = {
    glyphs: data[0],
    box: { width: data[9], height: data[10], x: i8(data[11]), y: i8(data[12]) },
    ascentA: i8(data[13]),
    descentG: i8(data[14]),
    ascentParen: i8(data[15]),
    descentParen: i8(data[16]),
  };
  const unicode = (data[21] << 8) | data[22];
  const glyphs: Glyph[] = [];
  const read = (code: number, at: number) => {
    const r = new BitReader(data, at);
    const width = r.get(bw);
    const height = r.get(bh);
    const x = r.signed(bx);
    const y = r.signed(by);
    const advance = r.signed(bd);
    const bits = new Uint8Array(width * height);
    if (width && height) {
      let n = 0;
      for (;;) {
        const zeros = r.get(m0);
        const ones = r.get(m1);
        do {
          n += zeros;
          for (let k = 0; k < ones; k++) bits[n++] = 1;
        } while (r.get(1));
        if (n >= width * height) break;
      }
    }
    glyphs.push({ code, width, height, x, y, advance, bits });
  };
  let at = 23;
  while (data[at + 1]) {
    read(data[at], at + 2);
    at += data[at + 1];
  }
  // The jump table's first entry leads to the first glyph above U+00FF; the rest follow it.
  at = 23 + unicode + ((data[23 + unicode] << 8) | data[24 + unicode]);
  for (;;) {
    const code = (data[at] << 8) | data[at + 1];
    if (!code) break;
    read(code, at + 3);
    at += data[at + 2];
  }
  return { header, glyphs };
}
