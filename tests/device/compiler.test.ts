import { CupSodaIcon } from "@matecrew/device-ui/icons/lucide";
import * as sdk from "@matecrew/device-ui";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { compileScreen, encodeScene, deflate, pack } from "@matecrew/device-ui/compiler";
import { compileApp, loadProject } from "../../device/sdk/cli/project";
import example from "../../device/apps/hello";

test("every committed .dui and generated registry matches its TSX source", async () => {
  const project = await loadProject(
    new URL("../../device", import.meta.url).pathname,
  );
  let mate = 0;
  let screens = 0;
  for (const name of Object.keys(project.config.apps)) {
    const { artifacts, outputs } = await compileApp(project, name);
    assert.ok(artifacts.length > 0, name);
    for (const output of outputs) {
      const expected =
        typeof output.data === "string"
          ? new TextEncoder().encode(output.data)
          : output.data;
      assert.deepEqual(
        new Uint8Array(await readFile(output.path)),
        expected,
        `${output.path}: run \`bun dui build\``,
      );
    }
    for (const { bytes, raw } of artifacts) {
      const magic = new TextDecoder().decode(bytes.slice(0, 4));
      if (magic === "DUIZ") {
        // DEFLATE-packed DUI1: the announced size, and any inflater gets the bytecode back.
        const dui1 = new Uint8Array(inflateRawSync(bytes.slice(8)));
        assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true), raw);
        assert.equal(dui1.length, raw);
        assert.equal(new TextDecoder().decode(dui1.slice(0, 4)), "DUI1");
      } else assert.equal(magic, "DUI1");
    }
    if (name === "mate") {
      mate = artifacts.reduce((sum, { bytes }) => sum + bytes.length, 0);
      screens = artifacts.length;
    }
  }
  // Native 800 × 480 screens carry packed art; compressed, they stay under 1.2 KB each on average
  // (the account, failure and about screens carry sentences in every language).
  assert.ok(mate > 0 && mate < screens * 1_200, `maté screens exceed 1.2 KB each on average: ${mate} B for ${screens}`);
  const scene = compileScreen(example);
  assert.ok(encodeScene(scene).length < JSON.stringify(scene).length / 2);
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
        sdk.Empty({
          children: [
            sdk.EmptyMedia({ children: CupSodaIcon({ size: 48 }) }),
            sdk.EmptyTitle({ children: "Ready" }),
            sdk.EmptyDescription({ children: theme }),
          ],
        }),
        sdk.Pressable({
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

test("the DEFLATE encoder is deterministic and any inflater reads it", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255;
  const inputs = [
    new Uint8Array(0),
    new Uint8Array([42]),
    new Uint8Array(1000),
    Uint8Array.from({ length: 70_000 }, random), // beyond the 32 KiB window, incompressible
    Uint8Array.from({ length: 5000 }, (_, i) => i % 7),
    encodeScene(compileScreen(example)),
  ];
  for (const input of inputs) {
    const stream = deflate(input);
    assert.deepEqual(new Uint8Array(inflateRawSync(stream)), input);
    assert.deepEqual(deflate(input), stream);
  }
  // Packing only pays on real bytecode; a tiny or random payload stays DUI1 as is.
  const scene = encodeScene(compileScreen(example));
  assert.ok(pack(scene).length < scene.length * 0.7);
  assert.deepEqual(pack(new Uint8Array([1, 2, 3])), new Uint8Array([1, 2, 3]));
});
