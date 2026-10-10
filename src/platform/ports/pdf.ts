import type { ReactElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";

/**
 * PDF rendering of React-PDF documents (the settlement statements). The
 * documents are shared code; what differs per runtime is how React-PDF's
 * layout engine, a WebAssembly module, gets loaded.
 */
export interface PdfRenderer {
  /** The document's PDF bytes. */
  render(document: ReactElement<DocumentProps>): Promise<Uint8Array>;
}
