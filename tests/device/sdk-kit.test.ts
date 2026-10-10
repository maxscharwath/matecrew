import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as ui from "../../device/authoring";
import { compileScreen } from "../../device/authoring/jsx-runtime";
import { encodeScene } from "../../device/authoring/binary";
import { DeviceWasm } from "../../src/lib/device/virtual/wasm";
import { downloadImage } from "../../src/lib/device/virtual/images";
import kitDemo from "../../device/screens/kit-demo";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
async function wasm() {
  const bytes = await readFile(
    new URL("../../public/device/matecrew.wasm", import.meta.url),
  );
  globalThis.fetch = (async () =>
    new Response(bytes, {
      headers: { "Content-Type": "application/wasm" },
    })) as typeof fetch;
  return DeviceWasm.load();
}

test("TSX callbacks compile to buzzer effects emitted on every press", async () => {
  const app = compileScreen(() => {
    const buzzer = ui.useBuzzer();
    return ui.Screen({
      width: 200,
      height: 120,
      children: ui.Button({
        x: 4,
        y: 104,
        width: 84,
        height: 16,
        label: "Test",
        input: "left",
        onPress: () => buzzer.beep("success"),
      }),
    });
  });
  const runtime = await wasm();
  runtime.loadApp(encodeScene(app));
  for (let press = 0; press < 3; press++)
    assert.deepEqual(runtime.pressApp(32, 113), [
      { kind: "beep", tone: "success" },
    ]);
  assert.deepEqual(runtime.pressApp(100, 50), []);
  assert.deepEqual(runtime.inputApp("left"), [
    { kind: "beep", tone: "success" },
  ]);
  assert.equal(runtime.inputApp("right"), null);
});

test("bound web images decode in Rust/Wasm and restore without network", async () => {
  const scene = compileScreen(() => {
    const data = ui.useDeviceData("profile", "/profile");
    return ui.Screen({
      width: 200,
      height: 120,
      children: ui.Image({ width: 24, height: 24, src: data("avatar") }),
    });
  });
  const runtime = await wasm();
  const binary = encodeScene(scene);
  runtime.loadApp(binary);
  assert.deepEqual(runtime.imageRequests(), []);
  runtime.updateApp("profile", {
    avatar: "https://cdn.example.com/avatar.png",
  });
  const [request] = runtime.imageRequests();
  assert.equal(request.src, "https://cdn.example.com/avatar.png");
  const placeholder = runtime.renderApp();
  const png = await readFile(
    new URL("../../device/engine/tests/fixtures/colors.png", import.meta.url),
  );
  assert(runtime.updateImage(request, png));
  const rendered = runtime.renderApp();
  assert.notDeepEqual(rendered, placeholder);
  assert.deepEqual(runtime.imageRequests(), []);
  const cache = runtime.cacheApp();
  runtime.loadApp(binary);
  runtime.restoreApp(cache);
  assert.deepEqual(runtime.renderApp(), rendered);
  assert.deepEqual(runtime.imageRequests(), []);
  runtime.updateApp("profile", { avatar: "https://cdn.example.com/new.png" });
  assert.throws(() => runtime.updateImage(request, png), /stale/);
  runtime.updateApp("profile", { avatar: "//external.test/bad" });
  assert.deepEqual(runtime.imageRequests(), []);
});

test("composed chart data updates and line/bar/area render distinctly", async () => {
  const runtime = await wasm();
  const renders: Uint8Array[] = [];
  for (const series of [ui.Line, ui.Bar, ui.Area]) {
    const definition = compileScreen(() => {
      const data = ui.useDeviceData("metrics", "/metrics");
      return ui.Screen({
        width: 200,
        height: 120,
        children: ui.ComposedChart({
          width: 200,
          height: 120,
          data: data("history"),
          xKey: "day",
          children: series({ dataKey: "count", name: "Activity" }),
        }),
      });
    });
    runtime.loadApp(encodeScene(definition));
    const empty = runtime.renderApp();
    runtime.updateApp("metrics", {
      history: [
        { day: "Mon", count: 2 },
        { day: "Tue", count: 12 },
        { day: "Wed", count: 5 },
      ],
    });
    const rendered = runtime.renderApp();
    assert.notDeepEqual(rendered, empty);
    renders.push(rendered);
    runtime.updateApp("metrics", {
      history: [
        { day: "Mon", count: 9 },
        { day: "Tue", count: null },
        { day: "Wed", count: -5 },
      ],
    });
    assert.notDeepEqual(runtime.renderApp(), rendered);
  }
  assert.notDeepEqual(renders[0], renders[1]);
  assert.notDeepEqual(renders[0], renders[2]);
  assert.deepEqual(
    encodeScene(compileScreen(kitDemo)),
    new Uint8Array(
      await readFile(
        new URL("../../device/screens/kit-demo.dui", import.meta.url),
      ),
    ),
  );
});

test("compiler rejects invalid image sources, oversized images and excessive chart series", () => {
  for (const src of [
    "//external.test/a",
    "http://external.test/a",
    "https://user:secret@external.test/a",
    "data:image/png,a",
  ]) {
    assert.throws(
      () =>
        encodeScene(
          compileScreen(() =>
            ui.Screen({
              width: 200,
              height: 120,
              children: ui.Image({ src, width: 24, height: 24 }),
            }),
          ),
        ),
      /Image src/,
    );
  }
  assert.throws(
    () =>
      encodeScene(
        compileScreen(() =>
          ui.Screen({
            width: 200,
            height: 120,
            children: ui.Image({ src: "/a.png", width: 257, height: 24 }),
          }),
        ),
      ),
    /web image width/,
  );
  assert.throws(
    () =>
      encodeScene(
        compileScreen(() =>
          ui.Screen({
            width: 200,
            height: 120,
            children: ui.LineChart({
              width: 200,
              height: 80,
              data: [],
              children: Array.from({ length: 5 }, () =>
                ui.Line({ dataKey: "count" }),
              ),
            }),
          }),
        ),
      ),
    /chart series count/,
  );
  assert.throws(
    () =>
      compileScreen(() =>
        ui.Screen({
          width: 200,
          height: 120,
          children: ui.Line({ dataKey: "count" }),
        }),
      ),
    /inside a chart/,
  );
});

test("image downloads omit third-party credentials and bound streaming bodies", async () => {
  const requests: RequestInit[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init!);
    return new Response(new Uint8Array([1, 2, 3]));
  }) as typeof fetch;
  const signal = new AbortController().signal;
  await downloadImage("https://cdn.example.com/a.png", "private-token", signal);
  await downloadImage("/a.png", "private-token", signal);
  assert.equal(new Headers(requests[0].headers).get("authorization"), null);
  assert.equal(
    new Headers(requests[1].headers).get("authorization"),
    "Bearer private-token",
  );
  assert.equal(requests[0].credentials, "omit");
  assert.equal(requests[0].redirect, "error");
  let cancelled = false;
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(65_537));
        },
        cancel() {
          cancelled = true;
        },
      }),
    )) as typeof fetch;
  await assert.rejects(
    downloadImage("/a.png", "private-token", signal),
    /64 KiB/,
  );
  assert(cancelled);
});

test("Showcase routes retain a bounded stack and state across offline restart", async () => {
  const runtime = await wasm();
  runtime.loadShowcase();
  const home = runtime.renderApp();
  assert.equal(
    (runtime.cacheApp().$navigation as { current: string }).current,
    "home",
  );
  assert.deepEqual(runtime.imageRequests(), []);
  runtime.inputApp("left");
  assert.deepEqual(runtime.renderApp(), home);
  runtime.inputApp("right");
  assert.equal(
    (runtime.cacheApp().$navigation as { current: string }).current,
    "components",
  );
  assert.notDeepEqual(runtime.renderApp(), home);
  runtime.inputApp("right");
  runtime.inputApp("left");
  assert.equal(
    (runtime.cacheApp().$navigation as { current: string }).current,
    "components",
  );
  const saved = runtime.cacheApp();
  runtime.loadShowcase();
  runtime.restoreApp(saved);
  assert.equal(
    (runtime.cacheApp().$navigation as { current: string }).current,
    "components",
  );
  for (let i = 0; i < 4; i++) runtime.inputApp("right");
  assert.equal(
    (runtime.cacheApp().$navigation as { current: string }).current,
    "media",
  );
  assert.equal(runtime.imageRequests().length, 1);
  runtime.inputApp("right");
  runtime.pressApp(165, 85);
  assert.equal((runtime.cacheApp().local as { theme: string }).theme, "dark");
  runtime.inputApp("right");
  runtime.pressApp(90, 77);
  assert.equal(
    (runtime.cacheApp().local as { showcaseProgress: number }).showcaseProgress,
    80,
  );
  runtime.inputApp("right");
  assert.deepEqual(runtime.pressApp(90, 77), [
    { kind: "beep", tone: "success" },
  ]);
  runtime.inputApp("right");
  assert.equal(
    (runtime.cacheApp().$navigation as { current: string }).current,
    "home",
  );
  assert.deepEqual(
    (runtime.cacheApp().$navigation as { stack: string[] }).stack,
    ["home"],
  );
});

test("docked keys meet the display edge and preserve physical and pointer actions", async () => {
  const app = compileScreen(() =>
    ui.Screen({
      width: 400,
      height: 240,
      children: ui.KeyBar({
        left: "Retour",
        right: "Suite",
        onLeft: { kind: "beep", tone: "key" },
        onRight: { kind: "beep", tone: "success" },
      }),
    }),
  );
  const runtime = await wasm();
  runtime.loadApp(encodeScene(app));
  const frame = runtime.renderApp();
  const ink = (x: number, y: number) =>
    !!(frame[y * 100 + (x >> 3)] & (128 >> (x & 7)));
  // Square lower corners touch the panel edge, while the downward arrow is paper.
  assert(ink(0, 479));
  assert(ink(279, 479));
  assert(ink(520, 479));
  assert(ink(799, 479));
  assert.deepEqual(runtime.inputApp("left"), runtime.pressApp(32, 119));
  assert.deepEqual(runtime.inputApp("right"), runtime.pressApp(168, 119));
  assert.deepEqual(runtime.pressApp(100, 115), []);
});
