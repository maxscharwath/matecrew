import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import sonarjs from "eslint-plugin-sonarjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // SonarQube's own JS/TS rules (the analyzer SonarQube for IDE runs), over the whole repo from
  // the command line: `bun run lint`.
  sonarjs.configs.recommended,
  // Build-time device TSX emits binary nodes, with no DOM or React reconciliation.
  // Its JSX text compiles to bytecode, never to HTML: apostrophes need no escaping.
  // Its `use*` helpers (useI18n, useLocale, useT) are plain functions run once per build, and
  // screens are lowercase exports named after their .dui file: React's hook rules do not apply.
  {
    files: ["device/apps/**/*.tsx", "device/sdk/**/*.tsx", "tests/device/**/*.tsx"],
    rules: {
      "react/jsx-key": "off",
      "jsx-a11y/alt-text": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/rules-of-hooks": "off",
      "react/display-name": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated or copied code.
    ".claude/**",
    ".open-next/**",
    ".wrangler/**",
    "realtime/.wrangler/**",
    "src/generated/**",
    "device/dist/**",
    "device/**/target/**",
    "device/firmware/.embuild/**",
    "device/sdk/icons/{lucide,pixelarticons,streamline-pixel,system}.ts",
    "public/**",
  ]),
]);

export default eslintConfig;
