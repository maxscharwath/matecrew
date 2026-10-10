/**
 * A deterministic DEFLATE encoder (RFC 1951), so committed bytecode is the same on every machine
 * whatever the zlib behind the runtime. LZ77 over a 32 KiB window with hash chains and lazy
 * matching, then one block with dynamic Huffman codes limited to 15 bits. Any inflater reads it;
 * the engine uses miniz_oxide.
 */

const MIN_MATCH = 3;
const MAX_MATCH = 258;
const WINDOW = 32768;
const CHAIN = 256;

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

type Token = { literal: number } | { length: number; distance: number };

function bucket(value: number, bases: number[]): number {
  let i = bases.length - 1;
  while (bases[i] > value) i--;
  return i;
}

/** LZ77 with one-step lazy matching: take a match only if the next position's is not longer. */
function tokenize(input: Uint8Array): Token[] {
  const head = new Int32Array(1 << 15).fill(-1);
  const previous = new Int32Array(input.length).fill(-1);
  const hash = (i: number) => ((input[i] << 10) ^ (input[i + 1] << 5) ^ input[i + 2]) & 0x7fff;
  const insert = (i: number) => {
    if (i + MIN_MATCH > input.length) return;
    const h = hash(i);
    previous[i] = head[h];
    head[h] = i;
  };
  const longest = (i: number): [number, number] => {
    if (i + MIN_MATCH > input.length) return [0, 0];
    let best = 0, distance = 0;
    const limit = Math.min(MAX_MATCH, input.length - i);
    for (let j = head[hash(i)], tries = 0; j >= 0 && i - j <= WINDOW && tries < CHAIN; j = previous[j], tries++) {
      if (input[j + best] !== input[i + best]) continue;
      let l = 0;
      while (l < limit && input[j + l] === input[i + l]) l++;
      if (l > best) {
        best = l;
        distance = i - j;
        if (l === limit) break;
      }
    }
    return best >= MIN_MATCH ? [best, distance] : [0, 0];
  };
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const [length, distance] = longest(i);
    if (length) {
      insert(i);
      const [next] = longest(i + 1);
      if (next > length) {
        tokens.push({ literal: input[i] });
        i++;
        continue;
      }
      tokens.push({ length, distance });
      for (let k = 1; k < length; k++) insert(i + k);
      i += length;
    } else {
      insert(i);
      tokens.push({ literal: input[i] });
      i++;
    }
  }
  return tokens;
}

/** Huffman code lengths for `frequencies`, none longer than `limit`. Deterministic tie-breaks. */
function codeLengths(frequencies: number[], limit: number): number[] {
  let counts = frequencies.slice();
  for (;;) {
    const lengths = new Array<number>(counts.length).fill(0);
    const used = counts.map((f, symbol) => ({ f, symbol })).filter((s) => s.f > 0);
    // A lone symbol still gets a complete code: pair it with an unused one.
    if (used.length === 1) {
      lengths[used[0].symbol] = 1;
      lengths[used[0].symbol === 0 ? 1 : 0] = 1;
    }
    if (used.length > 1) {
      type Tree = { f: number; order: number; symbols: number[] };
      let order = 0;
      let queue: Tree[] = used.map((s) => ({ f: s.f, order: order++, symbols: [s.symbol] }));
      while (queue.length > 1) {
        queue.sort((a, b) => a.f - b.f || a.order - b.order);
        const [a, b] = queue;
        for (const s of [...a.symbols, ...b.symbols]) lengths[s]++;
        queue = [{ f: a.f + b.f, order: order++, symbols: [...a.symbols, ...b.symbols] }, ...queue.slice(2)];
      }
    }
    if (Math.max(...lengths) <= limit) return lengths;
    // Flatten the distribution and retry: rare symbols get shorter codes, common ones longer.
    counts = counts.map((f) => (f ? Math.max(1, f >> 1) : 0));
  }
}

/** Canonical codes from lengths (RFC 1951 3.2.2). */
function canonical(lengths: number[]): number[] {
  const max = Math.max(0, ...lengths);
  const count = new Array<number>(max + 1).fill(0);
  for (const l of lengths) if (l) count[l]++;
  const next = new Array<number>(max + 2).fill(0);
  for (let bits = 1, code = 0; bits <= max; bits++) {
    code = (code + count[bits - 1]) << 1;
    next[bits] = code;
  }
  return lengths.map((l) => (l ? next[l]++ : 0));
}

class Bits {
  readonly bytes: number[] = [];
  private value = 0;
  private count = 0;
  /** `n` bits, least significant first. */
  write(value: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.value |= ((value >>> i) & 1) << this.count;
      if (++this.count === 8) {
        this.bytes.push(this.value);
        this.value = 0;
        this.count = 0;
      }
    }
  }
  /** A Huffman code: most significant bit first. */
  code(code: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.write((code >>> i) & 1, 1);
  }
  finish(): Uint8Array {
    if (this.count) this.bytes.push(this.value);
    return Uint8Array.from(this.bytes);
  }
}

/** Raw DEFLATE stream (no zlib header) of `input`, in one dynamic-Huffman block. */
export function deflate(input: Uint8Array): Uint8Array {
  const tokens = tokenize(input);
  const literalFrequency = new Array<number>(286).fill(0);
  const distanceFrequency = new Array<number>(30).fill(0);
  for (const token of tokens) {
    if ("literal" in token) literalFrequency[token.literal]++;
    else {
      literalFrequency[257 + bucket(token.length, LENGTH_BASE)]++;
      distanceFrequency[bucket(token.distance, DIST_BASE)]++;
    }
  }
  literalFrequency[256] = 1;
  // At least one distance code, as some inflaters expect.
  if (!distanceFrequency.some(Boolean)) distanceFrequency[0] = 1;
  const literalLengths = codeLengths(literalFrequency, 15);
  const distanceLengths = codeLengths(distanceFrequency, 15);
  const literalCodes = canonical(literalLengths);
  const distanceCodes = canonical(distanceLengths);

  let hlit = 286;
  while (hlit > 257 && !literalLengths[hlit - 1]) hlit--;
  let hdist = 30;
  while (hdist > 1 && !distanceLengths[hdist - 1]) hdist--;

  // Code lengths of both alphabets, run-length encoded with symbols 16, 17 and 18.
  const sequence = [...literalLengths.slice(0, hlit), ...distanceLengths.slice(0, hdist)];
  const runs: [number, number, number][] = []; // symbol, extra value, extra bits
  for (let i = 0; i < sequence.length; ) {
    const value = sequence[i];
    let run = 1;
    while (i + run < sequence.length && sequence[i + run] === value) run++;
    if (value === 0 && run >= 3) {
      const n = Math.min(run, 138);
      runs.push(n >= 11 ? [18, n - 11, 7] : [17, n - 3, 3]);
      i += n;
    } else if (value !== 0 && run >= 4) {
      runs.push([value, 0, 0]);
      const n = Math.min(run - 1, 6);
      runs.push([16, n - 3, 2]);
      i += 1 + n;
    } else {
      runs.push([value, 0, 0]);
      i++;
    }
  }
  const lengthFrequency = new Array<number>(19).fill(0);
  for (const [symbol] of runs) lengthFrequency[symbol]++;
  const lengthLengths = codeLengths(lengthFrequency, 7);
  const lengthCodes = canonical(lengthLengths);
  let hclen = 19;
  while (hclen > 4 && !lengthLengths[CODE_LENGTH_ORDER[hclen - 1]]) hclen--;

  const out = new Bits();
  out.write(1, 1); // final block
  out.write(2, 2); // dynamic Huffman
  out.write(hlit - 257, 5);
  out.write(hdist - 1, 5);
  out.write(hclen - 4, 4);
  for (let i = 0; i < hclen; i++) out.write(lengthLengths[CODE_LENGTH_ORDER[i]], 3);
  for (const [symbol, extra, bits] of runs) {
    out.code(lengthCodes[symbol], lengthLengths[symbol]);
    if (bits) out.write(extra, bits);
  }
  for (const token of tokens) {
    if ("literal" in token) {
      out.code(literalCodes[token.literal], literalLengths[token.literal]);
      continue;
    }
    const l = bucket(token.length, LENGTH_BASE);
    out.code(literalCodes[257 + l], literalLengths[257 + l]);
    out.write(token.length - LENGTH_BASE[l], LENGTH_EXTRA[l]);
    const d = bucket(token.distance, DIST_BASE);
    out.code(distanceCodes[d], distanceLengths[d]);
    out.write(token.distance - DIST_BASE[d], DIST_EXTRA[d]);
  }
  out.code(literalCodes[256], literalLengths[256]);
  return out.finish();
}
