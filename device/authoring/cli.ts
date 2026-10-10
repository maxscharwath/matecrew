#!/usr/bin/env bun
/** Build-only CLI: app.tsx -> compact device bytecode. No JSON layout output or server rendering. */
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { compileScreen } from "./jsx-runtime";
import { encodeScene } from "./binary";
import { writeIfChanged } from "./build";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "device-ui <app.tsx> [output.dui]\n\nCompiles typed TSX into DUI1 bytecode. The Rust engine renders it on device.\nUse --check to validate without writing a file.",
  );
} else {
  try {
    if (args.some((arg) => arg.startsWith("-") && arg !== "--check"))
      throw new Error("Unknown option; use --help for usage");
    if (args.filter((arg) => !arg.startsWith("-")).length > 2)
      throw new Error("Expected a source path and optional output path");
    const source = resolve(
      args.find((arg) => !arg.startsWith("-")) ?? "device/screens/example.tsx",
    );
    const output = resolve(
      args.filter((arg) => !arg.startsWith("-")).at(1) ??
        source.slice(0, -extname(source).length) + ".dui",
    );
    const { default: component } = await import(pathToFileURL(source).href);
    if (typeof component !== "function")
      throw new Error("Export a default screen function from your TSX file");
    const bytes = encodeScene(compileScreen(component));
    if (!args.includes("--check")) await writeIfChanged(output, bytes);
    console.log(
      `${source} → ${args.includes("--check") ? "valid" : output} (${bytes.length} bytes)`,
    );
  } catch (error) {
    console.error(
      `Device UI build failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
