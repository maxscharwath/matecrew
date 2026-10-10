import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { deviceScreen, deviceState } from "../../src/lib/device/contract";
import { DeviceWasm } from "../../src/lib/device/virtual/wasm";
import { VirtualDevice } from "../../src/lib/device/virtual/runtime";
import definition from "../../device/fixtures/dashboard.json";
import { compileScreen, encodeScene } from "@matecrew/device-ui/compiler";
import { Cache, Keep, key, localStorageBackend } from "@matecrew/device-ui/cache";
import hello from "../../device/apps/hello";
import kitDemo from "./fixtures/kit-demo";

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
let device: VirtualDevice | undefined;
afterEach(() => {
  device?.dispose();
  device = undefined;
  globalThis.fetch = originalFetch;
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

function state() {
  return deviceState.parse({
    device: { id: "test", name: "Terminal" },
    office: { name: "Lausanne", timezone: "Europe/Zurich", locale: "fr" },
    keys: { left: { label: "Prendre" }, right: { label: "Mon compte" } },
    items: definition.items.map((i, n) => ({ ...i, id: `i${n + 1}` })),
    badges: [],
    syncTimes: [],
    serverTime: "2026-10-09T18:25:00Z",
    firmware: null,
    screen: definition,
    appUrl: null,
    theme: "paper",
  });
}

async function setup(offline = false, compiled: boolean | "kit" = false) {
  const wasmBytes = await readFile(
    new URL("../../public/device/matecrew.wasm", import.meta.url),
  );
  const paths: string[] = [];
  const appBytes = encodeScene(compileScreen(compiled === "kit" ? kitDemo : hello));
  const image = await readFile(
    new URL("../../public/device/streamline-coffee.png", import.meta.url),
  );
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    options?: RequestInit,
  ) => {
    const path = String(input);
    paths.push(path);
    if (path.endsWith(".wasm"))
      return new Response(wasmBytes, {
        headers: { "Content-Type": "application/wasm" },
      });
    if (offline) throw new TypeError("network unavailable");
    if (path === "/api/device/state")
      return Response.json({
        ...state(),
        appUrl: compiled ? "/api/device/ui" : null,
      });
    if (path === "/api/device/ui") return new Response(appBytes);
    if (path === "/device/streamline-coffee.png") return new Response(image);
    if (path.startsWith("/api/device/commands")) {
      await new Promise((_, reject) =>
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Stopped", "AbortError")),
          { once: true },
        ),
      );
    }
    if (path === "/api/device/status" || path === "/api/device/frame")
      return Response.json({});
    throw new Error(`Unexpected API request: ${path}`);
  }) as typeof fetch;
  const values = new Map([
    [
      "test",
      JSON.stringify({
        hardwareId: "sim-test",
        token: "test-token",
        deviceId: "test",
        deviceName: "Terminal",
        officeName: "Lausanne",
        queue: [],
        unknownBadges: [],
      }),
    ],
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  // The last state, cached as the runtime keeps it (`CACHED.state`, under the device's key).
  Cache.open(localStorageBackend({ prefix: "test:" })).put(key("state").keep(Keep.forever).maxBytes(96 * 1024), state());
  return { wasm: await DeviceWasm.load(), paths };
}
async function waitForPhase(phase: string) {
  const deadline = Date.now() + 3000;
  while (device?.getSnapshot().phase !== phase && Date.now() < deadline)
    await delay(10);
  assert.equal(device?.getSnapshot().phase, phase);
}

test("JSON definitions render and update in the shipped Rust/Wasm engine", async () => {
  const { wasm } = await setup();
  const data = deviceScreen.parse(definition);
  const bits = wasm.render({ type: "dashboard", data, offline: false });
  assert.equal(bits.length, 48_000);
  const changed = structuredClone(data);
  changed.items[0].stock++;
  assert.notDeepEqual(
    wasm.render({ type: "dashboard", data: changed, offline: false }),
    bits,
  );
  assert.deepEqual(
    wasm.render({ type: "main", state: state(), offline: false }),
    bits,
  );
});

test("virtual sync draws state locally without requesting a server frame", async () => {
  const { wasm, paths } = await setup();
  device = new VirtualDevice(wasm, "test");
  device.start();
  await waitForPhase("online");
  assert.deepEqual(
    device.getSnapshot().bits,
    wasm.render({ type: "main", state: state(), offline: false }),
  );
  assert(paths.includes("/api/device/state"));
  assert(!paths.includes("/api/device/screen"));
  const refreshes = device.getSnapshot().refreshes;
  device.replaceWasm(wasm);
  assert.equal(device.getSnapshot().refreshes, refreshes);
  device.setNetwork(false);
  assert.deepEqual(
    device.getSnapshot().bits,
    wasm.render({ type: "main", state: state(), offline: true }),
  );
});

test("virtual boot reconstructs a cached dashboard with the network unavailable", async () => {
  const { wasm } = await setup(true);
  device = new VirtualDevice(wasm, "test");
  device.start();
  await waitForPhase("offline");
  assert.deepEqual(
    device.getSnapshot().bits,
    wasm.render({ type: "main", state: state(), offline: true }),
  );
});

test("compiled binary apps fetch through hooks, handle local state and survive an offline restart", async () => {
  const { wasm, paths } = await setup(false, true);
  device = new VirtualDevice(wasm, "test");
  device.start();
  await waitForPhase("online");
  assert(paths.includes("/api/device/ui"));
  const before = device.getSnapshot().bits;
  device.press("right");
  const updated = device.getSnapshot().bits;
  assert.notDeepEqual(updated, before);
  assert.equal(
    wasm.cacheApp().local &&
      (wasm.cacheApp().local as { notice: string }).notice,
    "Choisis, puis badge",
  );
  device.setNetwork(false);
  device.restart();
  await waitForPhase("offline");
  // The status bar's clock advances across a restart; everything under it must persist.
  assert.deepEqual(device.getSnapshot().bits!.slice(56 * 100), updated!.slice(56 * 100));
});

test("theme selection redraws locally, survives sync and persists across offline restart", async () => {
  const { wasm } = await setup();
  device = new VirtualDevice(wasm, "test");
  device.start();
  await waitForPhase("online");
  const paper = device.getSnapshot().bits;
  // Kit screens pin their type: light themes agree, dark swaps ink and paper.
  device.setTheme("macos");
  assert.equal(device.getSnapshot().theme, "macos");
  assert.deepEqual(device.getSnapshot().bits, paper);
  device.setTheme("dark");
  assert.notDeepEqual(device.getSnapshot().bits, paper);
  assert.deepEqual(
    device.getSnapshot().bits,
    wasm.render({
      type: "main",
      state: { ...state(), theme: "dark" },
      offline: false,
    }),
  );
  const dark = device.getSnapshot().bits;
  device.syncNow();
  await delay(50);
  assert.equal(device.getSnapshot().theme, "dark");
  assert.deepEqual(device.getSnapshot().bits, dark);
  device.setNetwork(false);
  device.restart();
  await waitForPhase("offline");
  assert.equal(device.getSnapshot().theme, "dark");
  assert.deepEqual(
    device.getSnapshot().bits,
    wasm.render({
      type: "main",
      state: { ...state(), theme: "dark" },
      offline: true,
    }),
  );
});

test("virtual web images are downloaded once and survive offline restart", async () => {
  const { wasm, paths } = await setup(false, "kit");
  device = new VirtualDevice(wasm, "test");
  device.start();
  await waitForPhase("online");
  assert(paths.includes("/device/streamline-coffee.png"));
  assert.deepEqual(wasm.imageRequests(), []);
  const rendered = device.getSnapshot().bits;
  device.syncNow();
  await delay(100);
  assert.equal(
    paths.filter((path) => path === "/device/streamline-coffee.png").length,
    1,
  );
  device.setNetwork(false);
  device.restart();
  await waitForPhase("offline");
  assert.deepEqual(device.getSnapshot().bits, rendered);
});

test("remote-style app selection and screen taps drive Showcase without hardware keys", async () => {
  const { wasm } = await setup();
  device = new VirtualDevice(wasm, "test");
  device.start();
  await waitForPhase("online");
  const mate = device.getSnapshot().bits;
  const beeps: string[] = [];
  device.setBeep((beep) => beeps.push(beep));
  device.selectApp("showcase");
  assert.equal(device.getSnapshot().app, "showcase");
  assert.notDeepEqual(device.getSnapshot().bits, mate);
  device.tapScreen(150, 31); // Home menu, "Composants" (taps use the 200 × 120 transport grid).
  assert.equal(
    (wasm.cacheApp().$navigation as { current: string }).current,
    "components",
  );
  device.tapScreen(24, 87); // "Prendre"
  device.tapScreen(24, 87);
  assert.deepEqual(beeps, ["accepted", "accepted"]);
  device.selectApp("mate");
  assert.deepEqual(device.getSnapshot().bits, mate);
  device.selectApp("showcase");
  assert.equal(
    (wasm.cacheApp().$navigation as { current: string }).current,
    "components",
  );
  device.setNetwork(false);
  const frame = device.getSnapshot().bits;
  device.restart();
  await waitForPhase("offline");
  // The clock is host metadata and advances across a restart; route/content must persist.
  assert.deepEqual(
    device.getSnapshot().bits!.slice(56 * 100),
    frame!.slice(56 * 100),
  );
});
