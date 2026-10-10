import { renderToBuffer } from "@react-pdf/renderer";
import type { PdfRenderer } from "../ports/pdf";

/** React-PDF as published: on Node, yoga compiles its embedded WebAssembly itself. */
export const reactPdf: PdfRenderer = {
  render: (document) => renderToBuffer(document),
};
