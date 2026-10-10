import { LIMITS } from "../runtime/limits";
export class Writer {
  readonly bytes: number[] = [];
  append(bytes: ArrayLike<number> & Iterable<number>): void {
    if (this.bytes.length + bytes.length > LIMITS.bytes)
      throw new Error("Bytecode exceeds device size limit");
    for (const byte of bytes) this.bytes.push(byte);
  }
  u8(value: number): void {
    integer(value, 0, 255, "u8");
    this.append([value]);
  }
  u16(value: number): void {
    integer(value, 0, 65535, "u16");
    this.append([value & 255, value >> 8]);
  }
  i16(value: number): void {
    integer(value, -32768, 32767, "i16");
    this.u16(value & 65535);
  }
  u32(value: number): void {
    integer(value, 0, 0xffffffff, "u32");
    for (let i = 0; i < 4; i++) this.u8((value >>> (i * 8)) & 255);
  }
  number(value: number, integral: boolean): void {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    if (integral) view.setBigInt64(0, BigInt(value), true);
    else view.setFloat64(0, value, true);
    this.append(new Uint8Array(buffer));
  }
}
export function integer(
  value: number,
  min: number,
  max: number,
  label: string,
): void {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${label}: ${value} (expected ${min}..${max})`);
}
