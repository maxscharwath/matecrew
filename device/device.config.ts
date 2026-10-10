import { defineConfig } from "@matecrew/device-ui/config";

/** Every app this repository builds. `bun dui build` writes them; `bun dui check` verifies the committed copies. */
export default defineConfig({
  apps: {
    mate: {
      entry: "apps/mate/index.ts",
      screens: true,
      out: "dist/mate",
      rust: "ui/src/screens.rs",
      previews: "apps/mate/previews.json",
    },
    system: {
      entry: "apps/system/index.ts",
      screens: true,
      out: "dist/system",
      previews: "apps/system/previews.ts",
    },
    showcase: {
      entry: "apps/showcase/index.tsx",
      out: "dist/showcase.dui",
      previews: "apps/showcase/previews.ts",
    },
    hello: {
      entry: "apps/hello/index.tsx",
      out: ["dist/hello.dui", "engine/tests/fixtures/app.dui"],
      previews: "apps/hello/previews.ts",
    },
  },
});
