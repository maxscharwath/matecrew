/**
 * Copies the WebAssembly binary that yoga-layout (React-PDF's layout engine)
 * embeds in base64 to src/platform/cloudflare/pdf/yoga.wasm, where the Worker
 * imports it as a module. Run after upgrading @react-pdf/renderer, when
 * tests/platform/yoga-wasm.test.ts says the copy is stale:
 *
 *   bun scripts/extract-yoga-wasm.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);

export const YOGA_WASM_PATH = join(dirname(here), "../src/platform/cloudflare/pdf/yoga.wasm");

/** Resolves `specifier` the way the package at `from` sees it. */
function resolveFrom(from: string, specifier: string): string {
  return createRequire(from).resolve(specifier);
}

/** The binary embedded in the yoga-layout that @react-pdf/renderer uses. */
export function embeddedYogaWasm(): Uint8Array {
  const renderer = resolveFrom(here, "@react-pdf/renderer");
  const layout = resolveFrom(renderer, "@react-pdf/layout");
  const loader = resolveFrom(layout, "yoga-layout/load");
  const source = readFileSync(join(dirname(loader), "../binaries/yoga-wasm-base64-esm.js"), "utf8");
  const base64 = /data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/.exec(source)?.[1];
  if (!base64) throw new Error("yoga-layout no longer embeds its binary in base64: revisit src/platform/cloudflare/pdf");
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

if (process.argv[1] === here) {
  const wasm = embeddedYogaWasm();
  writeFileSync(YOGA_WASM_PATH, wasm);
  console.log(`Wrote ${wasm.length} bytes to ${YOGA_WASM_PATH}; set YOGA_WASM_BYTES to ${wasm.length}.`);
}
