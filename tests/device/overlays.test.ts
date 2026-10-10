import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DeviceWasm } from "../../src/lib/device/virtual/wasm";
const LINKED = { type: "linked", office: "Lausanne", name: "Terminal" } as const;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
test("system notifications overlay built-in screens, expire offline and clear on reboot", async () => {
  const bytes = await readFile(
    new URL("../../public/device/matecrew.wasm", import.meta.url),
  );
  globalThis.fetch = (async () =>
    new Response(bytes, {
      headers: { "Content-Type": "application/wasm" },
    })) as typeof fetch;
  const app = await DeviceWasm.load();
  const idle = app.render(LINKED);
  assert.equal(app.notify("Bonjour !", 1000, 100), true);
  assert.equal(app.overlayDeadline(), 1100);
  assert.notDeepEqual(app.render(LINKED), idle);
  assert.equal(app.tickApp(1100), true);
  assert.deepEqual(app.render(LINKED), idle);
  app.notify("À bientôt", 1000, 1200);
  app.sampleGpio(true, false, 0);
  app.reset();
  assert.equal(app.overlayDeadline(), null);
  assert.deepEqual(app.render(LINKED), idle);
  // The key held across the reset is a new press, the left key once released.
  assert.equal(app.sampleGpio(true, false, 0), 0);
  assert.equal(app.sampleGpio(false, false, 120), 1);
  assert.equal(app.notify("Nouveau départ", 1000, 0), true);
  assert.equal(app.overlayDeadline(), 1000);
});
test("toasts expire offline and dialogs capture input until one confirmation or cancellation", async () => {
  const bytes = await readFile(
    new URL("../../public/device/matecrew.wasm", import.meta.url),
  );
  globalThis.fetch = (async () =>
    new Response(bytes, {
      headers: { "Content-Type": "application/wasm" },
    })) as typeof fetch;
  const app = await DeviceWasm.load();
  app.loadShowcase();
  // Nine pages after home: the hardware page (transport taps are 200 × 120).
  for (let i = 0; i < 9; i++) app.inputApp("right");
  app.tickApp(100);
  app.pressApp(37, 64); // toast
  assert.equal(app.overlayDeadline(), 5100);
  const notification = app.renderApp();
  assert.equal(app.tickApp(5099), false);
  assert.equal(app.tickApp(5100), true);
  assert.equal(app.overlayDeadline(), null);
  assert.notDeepEqual(app.renderApp(), notification);
  app.pressApp(100, 64); // dialog
  const route = app.cacheApp().$navigation;
  assert.deepEqual(app.pressApp(10, 10), []); // modal backdrop
  assert.deepEqual(app.inputApp("unbound"), []); // cannot fall through to domain keys
  assert.deepEqual(app.cacheApp().$navigation, route);
  assert.deepEqual(app.inputApp("right"), [{ kind: "beep", tone: "success" }]);
  assert.deepEqual(app.inputApp("right"), []); // next page, no second confirmation
  for (let i = 0; i < 9; i++) app.inputApp("right"); // hardware after home reset
  app.pressApp(100, 64);
  assert.deepEqual(app.inputApp("left"), []); // cancellation
  assert.deepEqual(app.cacheApp().$navigation, route);
  const cache = app.cacheApp();
  app.loadShowcase();
  app.restoreApp(cache);
  assert.equal(app.overlayDeadline(), null);
  assert.equal(
    (app.cacheApp().$overlay as Record<string, unknown>).dialog,
    undefined,
  );
});
