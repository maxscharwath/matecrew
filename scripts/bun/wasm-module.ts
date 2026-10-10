import { plugin } from "bun";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Prisma client is generated for workerd, which imports its query compiler
 * as `*.wasm?module` (a compiled `WebAssembly.Module`). Bun reads that import
 * as a file path, so scripts and tests preload this plugin (bunfig.toml) to
 * give it the same meaning.
 */
plugin({
  name: "wasm-module",
  setup(build) {
    build.onResolve({ filter: /\.wasm\?module$/ }, (args) => ({
      path: path.resolve(path.dirname(args.importer), args.path.replace(/\?module$/, "")),
      namespace: "wasm-module",
    }));
    build.onLoad({ filter: /.*/, namespace: "wasm-module" }, (args) => ({
      exports: { default: new WebAssembly.Module(readFileSync(args.path)) },
      loader: "object",
    }));
  },
});
