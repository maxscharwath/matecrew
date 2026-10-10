import { renderToBuffer } from "@react-pdf/renderer";
import type { PdfRenderer } from "../../ports/pdf";
import yoga from "./yoga.wasm?module";

/**
 * Size of ./yoga.wasm, the binary yoga-layout embeds in base64; how its
 * compilation request is recognised. scripts/extract-yoga-wasm.ts refreshes
 * both, and tests/platform/yoga-wasm.test.ts checks them.
 */
export const YOGA_WASM_BYTES = 71_736;

type Instantiate = typeof WebAssembly.instantiate;

let redirected = false;

/**
 * yoga-layout, React-PDF's layout engine, compiles the WebAssembly embedded
 * in its JavaScript on the first layout, and workerd refuses to compile code
 * at run time. The same binary is imported as a module (./yoga.wasm), which
 * wrangler compiles when it bundles the Worker: when yoga asks to compile its
 * bytes, it gets an instance of that module instead. Every other call goes
 * through untouched.
 */
function redirectYogaCompilation(): void {
  if (redirected) return;
  redirected = true;
  const instantiate = WebAssembly.instantiate.bind(WebAssembly) as Instantiate;
  async function instantiateYoga(source: BufferSource | WebAssembly.Module, imports?: WebAssembly.Imports) {
    if (source instanceof WebAssembly.Module) return instantiate(source, imports);
    if (source.byteLength !== YOGA_WASM_BYTES) return instantiate(source, imports);
    return { module: yoga, instance: await instantiate(yoga, imports) };
  }
  WebAssembly.instantiate = instantiateYoga as Instantiate;
}

/** React-PDF with yoga loaded from the module wrangler compiled. */
export const workerdReactPdf: PdfRenderer = {
  render(document) {
    redirectYogaCompilation();
    return renderToBuffer(document);
  },
};
