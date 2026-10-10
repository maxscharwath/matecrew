import { FoodDrinkCoffeeIcon } from "@matecrew/device-ui/icons/streamline-pixel";
import * as sdk from "../../device/authoring";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileScreen } from "../../device/authoring/jsx-runtime";
import { encodeScene } from "../../device/authoring/binary";
import * as screens from "../../device/screens/terminal";
import { rustScreenManifest } from "../../device/authoring/build";
import example from "../../device/screens/example";

test("every shipped screen is deterministic binary compiled from TSX", async () => {
  assert.ok(Object.keys(screens).length > 0);
  assert.equal(
    await readFile(
      new URL("../../device/ui/src/screens.rs", import.meta.url),
      "utf8",
    ),
    rustScreenManifest(Object.keys(screens)),
  );
  let total = 0;
  for (const [name, component] of Object.entries(screens)) {
    const bytes = encodeScene(compileScreen(component));
    const shipped = await readFile(
      new URL(`../../device/screens/compiled/${name}.dui`, import.meta.url),
    );
    assert.deepEqual(
      bytes,
      new Uint8Array(shipped),
      `${name}: rebuild terminal screens`,
    );
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "DUI1");
    total += bytes.length;
  }
  assert.ok(total < 16_000, `screen suite exceeds 16 KB: ${total}`);
  const scene = compileScreen(example);
  const bytes = encodeScene(scene);
  assert.ok(bytes.length < JSON.stringify(scene).length / 2);
  assert.deepEqual(
    bytes,
    new Uint8Array(
      await readFile(
        new URL("../../device/screens/example.dui", import.meta.url),
      ),
    ),
  );
});

test("compiler rejects executable values and oversized layouts", () => {
  const scene = compileScreen(example);
  assert.throws(
    () => encodeScene({ ...scene, state: { illegal: () => 42 } }),
    /executable/,
  );
  assert.throws(() => encodeScene({ ...scene, width: -1 }), /viewport width/);
  assert.throws(
    () =>
      encodeScene({
        ...scene,
        root: { kind: "unknown", rect: {} },
      } as unknown as sdk.SceneDefinition),
    /Unsupported device component/,
  );
});

test("compiler reports invalid API hooks, broken references and cyclic data before emitting bytecode", () => {
  const scene = compileScreen(example);
  const resource = scene.resources[0];
  assert.throws(
    () => encodeScene({ ...scene, resources: [resource, resource] }),
    /duplicate resource/,
  );
  for (const path of [
    "//external.example/data",
    "/\\external.example/data",
    "/data\nheader",
  ]) {
    assert.throws(
      () => encodeScene({ ...scene, resources: [{ ...resource, path }] }),
      /resource/,
    );
  }
  assert.throws(
    () =>
      encodeScene({
        ...scene,
        actions: { reload: { kind: "fetch", resource: "missing" } },
      }),
    /unknown resource/,
  );
  assert.throws(
    () =>
      encodeScene({
        ...scene,
        actions: { change: { kind: "setState", key: "missing", value: 1 } },
      }),
    /unknown state/,
  );
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(
    () => encodeScene({ ...scene, state: { cycle } }),
    /deep or cyclic/,
  );
  assert.throws(
    () => encodeScene({ ...scene, state: { date: new Date() } }),
    /JSON-compatible/,
  );
  assert.throws(
    () => encodeScene({ ...scene, state: { huge: "x".repeat(8192) } }),
    /Local state/,
  );
});

test("SDK components compile independently from the terminal and theme hooks remain portable", () => {
  // Use the public package entry, not any terminal helpers or domain types.
  const app = () => {
    const [theme, setTheme] = sdk.useDeviceTheme("macos");
    return sdk.Screen({
      width: 200,
      height: 120,
      children: [
        sdk.FeedbackCard({
          icon: FoodDrinkCoffeeIcon,
          title: "Ready",
          detail: theme,
        }),
        sdk.Button({
          x: 116,
          y: 104,
          width: 84,
          height: 16,
          label: "Dark",
          onPress: setTheme("dark"),
        }),
      ],
    });
  };
  const scene = compileScreen(app);
  assert.equal(scene.state.theme, "macos");
  assert.deepEqual(scene.actions.action0, {
    kind: "setState",
    key: "theme",
    value: "dark",
  });
  assert.ok(encodeScene(scene).length < 1024);
});
