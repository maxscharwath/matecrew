#!/usr/bin/env bun
/** `dui`: the device UI toolchain. Commands load `device.config.ts` from the working directory or a parent. */
import { build } from "./build";
import { check } from "./check";
import { render } from "./render";
import { test } from "./test";
import { dev } from "./dev";
import { bundle } from "./bundle";

const commands: Record<string, { run: (args: string[]) => Promise<void>; help: string }> = {
  build: { run: build, help: "build [app...]    compile apps to .dui (and generated Rust registries)" },
  check: { run: check, help: "check [app...]    fail if committed .dui or generated files are stale" },
  render: {
    run: render,
    help: "render [app...]   draw every preview to PNG, a contact sheet and an HTML index (--only, --out, --scale)",
  },
  test: {
    run: test,
    help: "test [app...]     compare every preview with its golden PNG (--update to accept changes)",
  },
  dev: {
    run: dev,
    help: "dev [app...]      studio: emulated terminal (panel, keys, buzzer, pins) and previews, live (--port)",
  },
  bundle: { run: bundle, help: "" },
  icons: {
    run: async () => {
      await import("../tools/icons/build.mjs");
      await import("../tools/icons/lucide.mjs");
    },
    help: "icons             regenerate the named icon modules and offline catalogue",
  },
};

const [name, ...args] = process.argv.slice(2);
if (!name || name === "help" || name === "--help" || name === "-h") {
  console.log(
    "dui <command>\n\n" +
      Object.values(commands)
        .filter((command) => command.help)
        .map((command) => `  ${command.help}`)
        .join("\n"),
  );
} else if (!commands[name]) {
  console.error(`Unknown command "${name}". Run \`dui help\`.`);
  process.exitCode = 1;
} else {
  try {
    await commands[name].run(args);
  } catch (error) {
    console.error(`dui ${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
