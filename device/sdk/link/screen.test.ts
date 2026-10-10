import { test } from "node:test";
import assert from "node:assert/strict";
import { UUIDS, crc32, encodeCommand } from "./protocol";
import {
  SCREEN_FIRST,
  SCREEN_LAST,
  SCREEN_WHOLE,
  ScreenReader,
  encodeScreenTap,
  encodeScreenUpdate,
  screenNotifications,
  screenRgba,
  type Screen,
} from "./screen";
import { BleDevice } from "./ble";

const W = 800;
const H = 480;

/** An 800 × 480 UI-like screen: a status bar, a box, text-like noise, a dithered area. */
function uiScreen(seed: number, textRows: [number, number]): Uint8Array {
  const bits = new Uint8Array((W * H) / 8);
  let state = seed;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 24;
  };
  for (let i = 100; i < 56 * 100; i += 7) bits[i] = 0x3c;
  for (let y = 100; y < 140; y++) bits.fill(0xff, y * 100 + 10, y * 100 + 40);
  for (let y = textRows[0]; y < textRows[1]; y++) for (let x = 12; x < 88; x += 3) bits[y * 100 + x] = next() & next();
  for (let y = 400; y < 470; y++) bits.fill(y % 2 ? 0x55 : 0xaa, y * 100 + 50, y * 100 + 90);
  return bits;
}

/** The notifications a device sends for this sequence of screens, numbered from `seq`. */
function stream(screens: Uint8Array[], room: number, seq = 0): Uint8Array[] {
  const out: Uint8Array[] = [];
  let before: Uint8Array | null = null;
  for (const after of screens) {
    const update = encodeScreenUpdate(before, after, W, H);
    before = after;
    if (!update) continue;
    const parts = screenNotifications(update, room, seq + out.length);
    out.push(...parts);
  }
  return out;
}

test("a whole screen has the firmware's layout, byte for byte", () => {
  // 32 × 3: blank, a bar ending in one pixel, the same again (core/src/link.rs has the same test).
  const frame = Uint8Array.of(0, 0, 0, 0, 0xff, 0xff, 0xff, 0x01, 0xff, 0xff, 0xff, 0x01);
  assert.equal(crc32(frame), 0x92b2f73d);
  assert.deepEqual(
    [...encodeScreenUpdate(null, frame, 32, 3)!],
    [0x01, 32, 0, 3, 0, 0, 0, 3, 0, 0x3d, 0xf7, 0xb2, 0x92, 0x81, 0x00, 0x80, 0xff, 0x00, 0x01, 0x81, 0x00],
  );
  assert.equal(encodeScreenUpdate(new Uint8Array(48_000), new Uint8Array(48_000), W, H), null, "nothing changed");
  assert.equal(encodeScreenUpdate(null, new Uint8Array(48_000), W, H)!.length, 18, "a blank screen is one long run");
});

test("the reader rebuilds every screen from the stream, at any MTU", () => {
  const main = uiScreen(1, [160, 380]);
  const clock = main.slice();
  clock.set([0x18, 0x24, 0x42, 0x81], 20 * 100 + 46);
  const other = uiScreen(2, [150, 420]);
  const screens = [new Uint8Array(48_000), main, clock, other, main];
  for (const room of [20, 100, 244, 512]) {
    const reader = new ScreenReader();
    const shown: Screen[] = [];
    for (const notification of stream(screens, room, 250)) {
      assert.ok(notification.length <= room);
      const step = reader.push(notification);
      assert.equal(step.resync, undefined);
      if (step.screen) shown.push(step.screen);
    }
    assert.equal(shown.length, screens.length);
    shown.forEach((screen, i) => assert.deepEqual(screen.bits, screens[i]));
    assert.deepEqual([shown[0].whole, shown[2].whole], [true, false]);
    assert.deepEqual(shown[2].changed, { y: 20, rows: 1 }, "the clock's row alone");
    assert.notEqual(shown[3].bits, shown[4].bits, "each screen is its own copy");
  }
});

test("a lost notification asks for the whole screen and skips updates until it comes", () => {
  const a = uiScreen(3, [100, 300]);
  const b = uiScreen(4, [120, 320]);
  const c = uiScreen(5, [140, 340]);
  const notifications = stream([a, b, c], 512);
  const keyCount = screenNotifications(encodeScreenUpdate(null, a, W, H)!, 512).length;
  const reader = new ScreenReader();
  const steps = notifications.filter((_, i) => i !== keyCount).map((n) => reader.push(n));
  assert.equal(steps.filter((s) => s.resync).length, 1, "asks once");
  assert.equal(steps.filter((s) => s.screen).length, 1, "only the first screen, before the loss");

  // The device answers with the whole screen, numbered after what it sent.
  const whole = screenNotifications(encodeScreenUpdate(null, c, W, H)!, 512, notifications.length);
  const last = whole.map((n) => reader.push(n)).at(-1)!;
  assert.deepEqual(last.screen?.bits, c);
});

test("an update on another screen fails its CRC and asks again; one before the first screen waits", () => {
  const a = uiScreen(6, [100, 300]);
  const b = uiScreen(7, [100, 300]);
  const reader = new ScreenReader();
  for (const n of screenNotifications(encodeScreenUpdate(null, b, W, H)!, 512)) reader.push(n);
  // An update from `a` to `b` applied on `b`: what a browser on the wrong screen would do.
  const diff = screenNotifications(encodeScreenUpdate(a, uiScreen(8, [100, 300]), W, H)!, 512, 100);
  const fresh = new ScreenReader();
  assert.deepEqual(fresh.push(diff[0]), {}, "out of the blue: the first notification sets the numbering");
  const steps = diff.slice(1).map((n) => fresh.push(n));
  assert.ok(steps.every((s) => !s.resync && !s.screen), "the whole screen was asked for already");
  const broken = new ScreenReader();
  const key = screenNotifications(encodeScreenUpdate(null, b, W, H)!, 512, 0);
  for (const n of key) broken.push(n);
  const wrong = screenNotifications(encodeScreenUpdate(a, uiScreen(8, [100, 300]), W, H)!, 512, key.length);
  const steps2 = wrong.map((n) => broken.push(n));
  assert.ok(steps2.slice(0, -1).every((s) => !s.resync), "numbered right: no loss");
  const step = steps2.at(-1)!;
  assert.equal(step.resync, true);
  assert.equal(step.screen, undefined);
  assert.equal(reader.push(Uint8Array.of(0)).screen, undefined, "too short to mean anything");
});

test("taps are checked and go to the screen in three bytes", () => {
  const tap = encodeScreenTap(199, 119);
  assert.ok(tap.ok && [...tap.value].join() === "2,199,119");
  assert.equal(encodeScreenTap(200, 0).ok, false);
  assert.equal(encodeScreenTap(1.5, 0).ok, false);
  const json = encodeCommand({ cmd: "tap", x: 10, y: 20 });
  assert.ok(json.ok && new TextDecoder().decode(json.value) === '{"cmd":"tap","x":10,"y":20}');
  assert.equal(encodeCommand({ cmd: "tap", x: 10, y: 120 }).ok, false);
});

test("pixels for a canvas", () => {
  const rgba = screenRgba({ width: 9, height: 1, bits: Uint8Array.of(0x80, 0x80) }, [1, 2, 3], [9, 9, 9]);
  assert.equal(rgba.length, 36);
  assert.deepEqual([...rgba.subarray(0, 8)], [1, 2, 3, 255, 9, 9, 9, 255]);
  assert.deepEqual([...rgba.subarray(32, 36)], [1, 2, 3, 255], "the ninth pixel starts the second byte");
});

/* A stand-in for Web Bluetooth: one device whose characteristics record writes and can notify. */
class FakeCharacteristic {
  value: DataView | null = null;
  writes: Uint8Array[] = [];
  notifying = false;
  private listeners = new Set<(event: Event) => void>();
  async readValue() {
    return new DataView(new TextEncoder().encode('{"protocol":1}').buffer);
  }
  async writeValueWithResponse(value: BufferSource) {
    this.writes.push(new Uint8Array(value as Uint8Array));
  }
  async startNotifications() {
    this.notifying = true;
    return this;
  }
  async stopNotifications() {
    this.notifying = false;
    return this;
  }
  addEventListener(_: string, listener: (event: Event) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_: string, listener: (event: Event) => void) {
    this.listeners.delete(listener);
  }
  notify(bytes: Uint8Array) {
    this.value = new DataView(bytes.slice().buffer);
    for (const listener of this.listeners) listener({ target: this } as unknown as Event);
  }
}

async function fakeDevice(withScreen: boolean) {
  const chars = new Map<string, FakeCharacteristic>();
  for (const [key, uuid] of Object.entries(UUIDS)) if (key !== "service" && (withScreen || key !== "screen")) chars.set(uuid, new FakeCharacteristic());
  const service = {
    async getCharacteristic(uuid: string) {
      const found = chars.get(uuid);
      if (!found) throw Object.assign(new Error("No Characteristics matching UUID"), { name: "NotFoundError" });
      return found;
    },
  };
  const server = { connected: true, connect: async () => server, disconnect() {}, getPrimaryService: async () => service };
  const device = { id: "d", name: "matecrew-50E4", gatt: server, addEventListener() {} };
  const before = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { bluetooth: { requestDevice: async () => device } }, configurable: true });
  const picked = await BleDevice.request();
  if (before) Object.defineProperty(globalThis, "navigator", before);
  else delete (globalThis as { navigator?: unknown }).navigator;
  assert.ok(picked.ok);
  return { device: picked.value, char: (key: keyof typeof UUIDS) => chars.get(UUIDS[key])! };
}

test("watchScreen subscribes, asks for the whole screen and hands each screen over; taps go to it", async () => {
  const { device, char } = await fakeDevice(true);
  assert.ok(device.hasScreen);
  const seen: Screen[] = [];
  const stop = device.watchScreen((screen) => seen.push(screen));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const screen = char("screen");
  assert.ok(screen.notifying);
  assert.deepEqual(screen.writes, [SCREEN_WHOLE]);

  const a = uiScreen(9, [100, 200]);
  const b = uiScreen(10, [100, 200]);
  for (const n of stream([a, b], 512)) screen.notify(n);
  assert.deepEqual(seen.map((s) => s.bits), [a, b]);

  const late: Screen[] = [];
  const stopLate = device.watchScreen((s) => late.push(s));
  assert.deepEqual(late[0]?.bits, b, "a second watcher gets the current screen at once");

  // A gap: the reader asks for the whole screen again.
  const [first] = screenNotifications(encodeScreenUpdate(b, a, W, H)!, 512, 200);
  screen.notify(first);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(screen.writes.length, 2);
  assert.deepEqual(screen.writes.at(-1), SCREEN_WHOLE);

  assert.ok((await device.send({ cmd: "tap", x: 10, y: 20 })).ok);
  assert.deepEqual([...screen.writes.at(-1)!], [2, 10, 20]);
  assert.ok((await device.send({ cmd: "key", side: "left" })).ok);
  assert.equal(new TextDecoder().decode(char("control").writes.at(-1)), '{"cmd":"key","side":"left"}');

  stop();
  assert.ok(screen.notifying, "another watcher remains");
  stopLate();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(screen.notifying, false);
});

test("a device without a screen mirror still connects; watching and taps say so", async () => {
  const { device } = await fakeDevice(false);
  assert.equal(device.hasScreen, false);
  const errors: string[] = [];
  device.watchScreen(() => assert.fail("no screen"), { onError: (error) => errors.push(error.code) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(errors, ["unsupported"]);
  const tap = await device.send({ cmd: "tap", x: 1, y: 1 });
  assert.equal(tap.ok ? null : tap.error.code, "unsupported");
  assert.ok((await device.info()).ok);
});

test("the first notification of an update carries FIRST, the last LAST", () => {
  const parts = screenNotifications(new Uint8Array(1000), 100, 0);
  assert.equal(parts[0][1], SCREEN_FIRST);
  assert.equal(parts.at(-1)![1], SCREEN_LAST);
  assert.equal(screenNotifications(new Uint8Array(10), 100)[0][1], SCREEN_FIRST | SCREEN_LAST);
});
