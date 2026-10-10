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

type Tree = { f: number; order: number; symbols: number[] };

/** Huffman code lengths for `counts`, unlimited. Ties go to the subtree made first. */
function huffmanLengths(counts: number[]): number[] {
  const lengths = new Array<number>(counts.length).fill(0);
  const used = counts.map((f, symbol) => ({ f, symbol })).filter((s) => s.f > 0);
  // A lone symbol still gets a complete code: pair it with an unused one.
  if (used.length === 1) {
    lengths[used[0].symbol] = 1;
    lengths[used[0].symbol === 0 ? 1 : 0] = 1;
  }
  if (used.length > 1) {
    let order = 0;
    let queue: Tree[] = used.map((s) => ({ f: s.f, order: order++, symbols: [s.symbol] }));
    while (queue.length > 1) {
      queue.sort((a, b) => a.f - b.f || a.order - b.order);
      const [a, b] = queue;
      for (const s of [...a.symbols, ...b.symbols]) lengths[s]++;
      queue = [{ f: a.f + b.f, order: order++, symbols: [...a.symbols, ...b.symbols] }, ...queue.slice(2)];
    }
  }
  return lengths;
}

/** Huffman code lengths for `frequencies`, none longer than `limit`. Deterministic tie-breaks. */
function codeLengths(frequencies: number[], limit: number): number[] {
  let counts = frequencies.slice();
  for (;;) {
    const lengths = huffmanLengths(counts);
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

/** An alphabet's code lengths and canonical codes. */
type Alphabet = { lengths: number[]; codes: number[] };
/** A code-length symbol, its extra value and extra bit count. */
type Run = [number, number, number];

function alphabet(frequencies: number[], limit: number): Alphabet {
  const lengths = codeLengths(frequencies, limit);
  return { lengths, codes: canonical(lengths) };
}

/** Symbol frequencies of the literal/length and distance alphabets, end of block included. */
function frequencies(tokens: Token[]): { literals: number[]; distances: number[] } {
  const literals = new Array<number>(286).fill(0);
  const distances = new Array<number>(30).fill(0);
  for (const token of tokens) {
    if ("literal" in token) literals[token.literal]++;
    else {
      literals[257 + bucket(token.length, LENGTH_BASE)]++;
      distances[bucket(token.distance, DIST_BASE)]++;
    }
  }
  literals[256] = 1;
  // At least one distance code, as some inflaters expect.
  if (!distances.some(Boolean)) distances[0] = 1;
  return { literals, distances };
}

/** How many leading code lengths to send: trailing unused symbols are left out, down to `min`. */
function sentLength(lengths: number[], min: number): number {
  let n = lengths.length;
  while (n > min && !lengths[n - 1]) n--;
  return n;
}

/** A run of `n` zero lengths (3 to 138). */
const zeros = (n: number): Run => (n >= 11 ? [18, n - 11, 7] : [17, n - 3, 3]);

/** Code lengths run-length encoded with symbols 16 (repeat), 17 and 18 (zeros). */
function runLengths(sequence: number[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < sequence.length; ) {
    const value = sequence[i];
    let run = 1;
    while (i + run < sequence.length && sequence[i + run] === value) run++;
    if (value === 0 && run >= 3) {
      const n = Math.min(run, 138);
      runs.push(zeros(n));
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
  return runs;
}

function writeToken(out: Bits, token: Token, literal: Alphabet, distance: Alphabet): void {
  if ("literal" in token) {
    out.code(literal.codes[token.literal], literal.lengths[token.literal]);
    return;
  }
  const l = bucket(token.length, LENGTH_BASE);
  out.code(literal.codes[257 + l], literal.lengths[257 + l]);
  out.write(token.length - LENGTH_BASE[l], LENGTH_EXTRA[l]);
  const d = bucket(token.distance, DIST_BASE);
  out.code(distance.codes[d], distance.lengths[d]);
  out.write(token.distance - DIST_BASE[d], DIST_EXTRA[d]);
}

/** Raw DEFLATE stream (no zlib header) of `input`, in one dynamic-Huffman block. */
export function deflate(input: Uint8Array): Uint8Array {
  const tokens = tokenize(input);
  const { literals, distances } = frequencies(tokens);
  const literal = alphabet(literals, 15);
  const distance = alphabet(distances, 15);
  const hlit = sentLength(literal.lengths, 257);
  const hdist = sentLength(distance.lengths, 1);

  // Code lengths of both alphabets, run-length encoded.
  const runs = runLengths([...literal.lengths.slice(0, hlit), ...distance.lengths.slice(0, hdist)]);
  const lengthFrequency = new Array<number>(19).fill(0);
  for (const [symbol] of runs) lengthFrequency[symbol]++;
  const lengths = alphabet(lengthFrequency, 7);
  let hclen = 19;
  while (hclen > 4 && !lengths.lengths[CODE_LENGTH_ORDER[hclen - 1]]) hclen--;

  const out = new Bits();
  out.write(1, 1); // final block
  out.write(2, 2); // dynamic Huffman
  out.write(hlit - 257, 5);
  out.write(hdist - 1, 5);
  out.write(hclen - 4, 4);
  for (let i = 0; i < hclen; i++) out.write(lengths.lengths[CODE_LENGTH_ORDER[i]], 3);
  for (const [symbol, extra, bits] of runs) {
    out.code(lengths.codes[symbol], lengths.lengths[symbol]);
    if (bits) out.write(extra, bits);
  }
  for (const token of tokens) writeToken(out, token, literal, distance);
  out.code(literal.codes[256], literal.lengths[256]);
  return out.finish();
}
