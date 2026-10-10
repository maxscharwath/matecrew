import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Screen } from "@matecrew/device-ui";
import { WifiIcon } from "@matecrew/device-ui/icons/pixelarticons";
import { FoodDrinkCoffeeIcon } from "@matecrew/device-ui/icons/streamline-pixel";
import * as pixel from "@matecrew/device-ui/icons/pixelarticons";
import * as streamline from "@matecrew/device-ui/icons/streamline-pixel";
import { compileScreen } from "../../device/authoring/jsx-runtime";
import { encodeScene } from "../../device/authoring/binary";
import type { IconComponent } from "../../device/authoring";
import { pixelGrid } from "../../scripts/device-icons/pixel-grid.mjs";
import sharp from "sharp";
const require = createRequire(import.meta.url);

test("all 662 Streamline SVGs recover a crisp 21-pixel grid without antialiasing", async () => {
  const data = require("@iconify-json/streamline-pixel/icons.json");
  for (const [name, icon] of Object.entries(data.icons) as [
    string,
    { body: string },
  ][]) {
    const normalized = pixelGrid(icon.body);
    assert.equal(normalized.width, 21, name);
    assert.equal(normalized.height, 21, name);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 21 21">${normalized.body}</svg>`;
    const pixels = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
    for (let i = 3; i < pixels.length; i += 4)
      assert(pixels[i] === 0 || pixels[i] === 255, name);
  }
});

test("both complete Iconify collections expose usable named components", () => {
  for (const [prefix, exports] of [
    ["pixelarticons", pixel],
    ["streamline-pixel", streamline],
  ] as const) {
    const data = require(`@iconify-json/${prefix}/icons.json`);
    const names = [
      ...Object.keys(data.icons),
      ...Object.keys(data.aliases ?? {}),
    ];
    assert.equal(Object.keys(exports).length, names.length);
    for (const name of names) {
      const pascal = name
        .split("-")
        .map((p) => p[0].toUpperCase() + p.slice(1))
        .join("");
      const component = /^\d/.test(pascal) ? `Icon${pascal}` : `${pascal}Icon`;
      const icon = (exports as Record<string, IconComponent>)[component]({});
      assert.equal(icon.kind, "image", component);
      if (icon.kind !== "image" || !("literal" in icon.value))
        throw new Error(component);
      const bits = icon.value.literal as number[];
      assert.equal(
        bits.length,
        Math.ceil((icon.sourceWidth * icon.sourceHeight) / 8),
        component,
      );
      assert(
        bits.some((byte) => byte > 0),
        component,
      );
    }
  }
});

test("named imports include only used packed sprites in the app binary", () => {
  const build = (children: ReturnType<IconComponent>[]) =>
    encodeScene(
      compileScreen(() => Screen({ width: 200, height: 120, children })),
    );
  const wifi = build([WifiIcon({ size: 24 })]);
  const both = build([
    WifiIcon({ size: 24 }),
    FoodDrinkCoffeeIcon({ size: 32, x: 30 }),
  ]);
  assert(wifi.length < 180);
  assert(both.length - wifi.length < 160);
  assert.equal(new TextDecoder().decode(wifi.slice(0, 4)), "DUI1");
  assert(!new TextDecoder().decode(both).includes("<svg"));
});

test("icon boxes preserve aspect ratio and use even source-pixel magnification", () => {
  const icon = WifiIcon({ x: 10, y: 20, width: 72, height: 48 });
  assert.equal(icon.kind, "image");
  if (icon.kind !== "image") throw new Error("image expected");
  assert.deepEqual(icon.rect, { x: 22, y: 20, width: 48, height: 48 });
  assert.throws(() => WifiIcon({ size: 0 }), /positive integer/);
});
