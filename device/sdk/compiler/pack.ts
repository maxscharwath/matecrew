/** DUIZ: DUI1 bytecode compressed with the deterministic DEFLATE encoder, when it pays. */
import { deflate } from "./deflate";

const MAGIC = [0x44, 0x55, 0x49, 0x5a]; // "DUIZ"

/** `DUIZ`, the DUI1 size (u32, little endian), the raw DEFLATE stream; or `bytes` if not smaller. */
export function pack(bytes: Uint8Array): Uint8Array {
  const stream = deflate(bytes);
  if (stream.length + 8 >= bytes.length) return bytes;
  const out = new Uint8Array(8 + stream.length);
  out.set(MAGIC);
  new DataView(out.buffer).setUint32(4, bytes.length, true);
  out.set(stream, 8);
  return out;
}
