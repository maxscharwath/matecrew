/** Device UI bytecode (`device/dist/*.dui`), imported `with { type: "bytes" }`. */
declare module "*.dui" {
  const bytes: Uint8Array;
  export default bytes;
}
