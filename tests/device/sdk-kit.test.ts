import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as ui from "@matecrew/device-ui";
import { compileScreen } from "@matecrew/device-ui/compiler";
import { encodeScene } from "@matecrew/device-ui/compiler";
import { DeviceWasm } from "../../src/lib/device/virtual/wasm";
import { downloadImage } from "../../src/lib/device/virtual/images";

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
      children: ui.Pressable({
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
  const current = () => (runtime.cacheApp().$navigation as { current: string }).current;
  const local = () => runtime.cacheApp().local as Record<string, unknown>;
  assert.equal(current(), "home");
  assert.deepEqual(runtime.imageRequests(), []);
  runtime.inputApp("left");
  assert.deepEqual(runtime.renderApp(), home);
  runtime.inputApp("right");
  assert.equal(current(), "type");
  assert.notDeepEqual(runtime.renderApp(), home);
  runtime.inputApp("right");
  runtime.inputApp("left");
  assert.equal(current(), "type");
  const saved = runtime.cacheApp();
  runtime.loadShowcase();
  runtime.restoreApp(saved);
  assert.equal(current(), "type");
  for (let i = 0; i < 5; i++) runtime.inputApp("right");
  assert.equal(current(), "media");
  assert.equal(runtime.imageRequests().length, 1);
  // Remote taps use the 200 × 120 transport grid (4 panel pixels per unit).
  runtime.inputApp("right");
  runtime.pressApp(85, 41); // Logique: "+", a state update computed on the device
  assert.equal(local().count, 2);
  runtime.inputApp("right");
  runtime.pressApp(158, 48); // Apparence: "Encre"
  assert.equal(local().theme, "dark");
  runtime.inputApp("right");
  assert.deepEqual(runtime.pressApp(100, 46), [ // Matériel: "Succès"
    { kind: "beep", tone: "success" },
  ]);
  runtime.inputApp("right");
  assert.equal(current(), "home");
  assert.deepEqual(
    (runtime.cacheApp().$navigation as { stack: string[] }).stack,
    ["home"],
  );
});

test("key tabs meet the display edge and preserve physical and pointer actions", async () => {
  const app = compileScreen(() =>
    ui.Screen({
      // As every screen: the main area fills, the keys stand on the bottom edge.
      children: [ui.Main({}), ui.Keys({
        reader: true,
        children: [
          ui.Key({ side: "left", onPress: { kind: "beep", tone: "key" }, children: "Retour" }),
          ui.Key({ side: "right", primary: true, onPress: { kind: "beep", tone: "success" }, children: "Suite" }),
        ],
      })],
    }),
  );
  const runtime = await wasm();
  runtime.loadApp(encodeScene(app));
  const frame = runtime.renderApp();
  const ink = (x: number, y: number) =>
    !!(frame[y * 100 + (x >> 3)] & (128 >> (x & 7)));
  // The keys strip sits at the bottom of the screen's flow; tabs are centred on the keys
  // (x 130 and 670): an outlined one shows its sides down to the last row, the primary is ink.
  assert(ink(15, 479) && ink(244, 479) && !ink(130, 479));
  assert(ink(560, 479) && ink(670, 479) && ink(780, 479));
  assert(!ink(400, 479));
  assert.deepEqual(runtime.inputApp("left"), runtime.pressApp(32, 113));
  assert.deepEqual(runtime.inputApp("right"), runtime.pressApp(167, 113));
  assert.deepEqual(runtime.pressApp(100, 115), []); // the reader hint is not a control
});

test("messages use i18next's format: plural suffixes, {{name}} and contexts", () => {
  const messages = ui.defineMessages({
    fr: {
      stock_zero: "Plus rien",
      stock_one: "{{count}} maté pour {{name}}",
      stock_other: "{{count}} matés pour {{name}}",
      hello: "Salut {{ name }} !",
      side: "Droite",
      side_left: "Gauche",
    },
    en: { stock_one: "{{count}} maté", stock_other: "{{count}} matés", hello: "Hi {{name}}!", side: "Right", side_left: "Left" },
  });
  // What the engine reads: an ICU subset, built from the i18next keys.
  assert.deepEqual(messages, {
    fr: {
      stock: "{count, plural, =0 {Plus rien} one {# maté pour {name}} other {# matés pour {name}}}",
      hello: "Salut {name} !",
      side: "Droite",
      side_left: "Gauche",
    },
    en: { stock: "{count, plural, one {# maté} other {# matés}}", hello: "Hi {name}!", side: "Right", side_left: "Left" },
  });
  const app = compileScreen(() => {
    const t = ui.useI18n(messages);
    return ui.Screen({
      children: [
        ui.H2({ children: t("stock", { count: ui.bind("view.count", 0), name: "Alex" }) }),
        ui.P({ children: t("side", { context: ui.bind("view.side", "right") }) }),
      ],
    });
  });
  assert.deepEqual(app.messages?.table["side#context"], [
    "{context, select, left {Gauche} other {Droite}}",
    "{context, select, left {Left} other {Right}}",
  ]);
  assert.equal(app.messages?.table.hello, undefined); // only the keys a screen uses
  assert.ok(encodeScene(app).length > 0);
  assert.throws(() => ui.defineMessages({ fr: { stock_one: "{{count}} maté" } }), /stock_other/);
  assert.throws(() => ui.defineMessages({ fr: { hello: "Salut {name}" } }), /\{\{name\}\}/);
});
