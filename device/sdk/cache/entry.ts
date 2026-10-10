/**
 * An entry as a backend stores it: a JSON header line, then the value.
 *
 * ```text
 * {"format":1,"version":1,"written":1791590400000,"keep":86400000,"type":"json","crc":123456789}
 * {"stock":36}
 * ```
 *
 * `written` is null when the clock was not set, `keep` null for ever, `type` "bytes" for a
 * `Uint8Array` kept as base64. `crc` is the CRC-32 (IEEE, as zlib) of the value's UTF-8, then of
 * the other fields, so a damaged or cut entry reads as missing.
 */

/** Entries in another layout read as missing: bump it when the header changes. */
export const FORMAT = 1;

export type Header = {
  format: number;
  version: number;
  /** Unix milliseconds, null when the clock was not set. */
  written: number | null;
  /** Milliseconds, null for ever. */
  keep: number | null;
  type: "json" | "bytes";
  crc: number;
};

const encoder = new TextEncoder();

/** The entry for an encoded value. */
export function seal(fields: Omit<Header, "format" | "crc">, payload: string): string {
  const header: Header = { format: FORMAT, ...fields, crc: checksum(fields, payload) };
  return `${JSON.stringify(header)}\n${payload}`;
}

/** The header and value of a whole, intact entry, or why it is not one. */
export function open(entry: string): { header: Header; payload: string } | { error: string } {
  const newline = entry.indexOf("\n");
  let header: Header;
  try {
    header = JSON.parse(newline < 0 ? "" : entry.slice(0, newline));
  } catch {
    return { error: "not a cache entry" };
  }
  if (!header || typeof header !== "object" || typeof header.format !== "number") return { error: "not a cache entry" };
  if (header.format !== FORMAT) return { error: "another format" };
  const payload = entry.slice(newline + 1);
  if (header.crc !== checksum(header, payload)) return { error: "bad checksum" };
  return { header, payload };
}

function checksum(fields: Omit<Header, "format" | "crc">, payload: string): number {
  const rest = `${fields.version} ${fields.written} ${fields.keep} ${fields.type}`;
  return crc32(encoder.encode(rest), crc32(encoder.encode(payload), 0xffffffff, false));
}

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, as zlib), continued from a running `crc` when given. */
export function crc32(bytes: Uint8Array, crc = 0xffffffff, finish = true): number {
  for (const byte of bytes) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return finish ? (crc ^ 0xffffffff) >>> 0 : crc >>> 0;
}

/** UTF-8 length without encoding: what a value or an entry takes. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) bytes += utf8Width(char.codePointAt(0) ?? 0);
  return bytes;
}

/** Bytes UTF-8 takes for a code point; a lone surrogate becomes U+FFFD, three bytes. */
function utf8Width(code: number): number {
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In slices: spreading a large array into fromCodePoint overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCodePoint(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.codePointAt(0) ?? 0);
}
