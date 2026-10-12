/** Binary glTF models (`assets/models/*.glb`), imported `with { type: "bytes" }`. */
declare module "*.glb" {
  const bytes: Uint8Array<ArrayBuffer>;
  export default bytes;
}
