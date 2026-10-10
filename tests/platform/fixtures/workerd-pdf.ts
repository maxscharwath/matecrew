/**
 * Renders a statement-like document the way the Worker does, in a runtime
 * that refuses to compile WebAssembly from bytes, as workerd does. Run in its
 * own process by tests/platform/pdf.test.ts, so that yoga has not been
 * loaded yet: prints the PDF's size, or exits with the error.
 */
import { createElement } from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { workerdReactPdf } from "../../../src/platform/cloudflare/pdf";

const instantiate = WebAssembly.instantiate.bind(WebAssembly) as typeof WebAssembly.instantiate;
function refuseBytes(source: BufferSource | WebAssembly.Module, imports?: WebAssembly.Imports) {
  if (!(source instanceof WebAssembly.Module)) {
    return Promise.reject(new WebAssembly.CompileError("Wasm code generation disallowed by embedder"));
  }
  return instantiate(source, imports);
}
WebAssembly.instantiate = refuseBytes as typeof WebAssembly.instantiate;

const document = createElement(
  Document,
  null,
  createElement(Page, { size: "A4" }, createElement(View, { style: { flexDirection: "row" } }, createElement(Text, null, "Statement"))),
);
const render = process.argv[2] === "plain" ? () => renderToBuffer(document) : () => workerdReactPdf.render(document);
const pdf = await render();
console.log(new TextDecoder().decode(pdf.subarray(0, 5)), pdf.length);
