import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { VirtualGpio } from "../../src/lib/device/virtual/gpio";
import { VirtualBuzzer } from "../../src/lib/device/virtual/buzzer";
import { DeviceWasm } from "../../src/lib/device/virtual/wasm";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("virtual GPIO levels pass through the firmware's Rust edge detector", async () => {
  const bytes = await readFile(
    new URL("../../public/device/matecrew.wasm", import.meta.url),
  );
  globalThis.fetch = (async () =>
    new Response(bytes, {
      headers: { "Content-Type": "application/wasm" },
    })) as typeof fetch;
  const wasm = await DeviceWasm.load();
  const gpio = new VirtualGpio();
  const sample = () => wasm.sampleGpio(gpio.read(5), gpio.read(8));
  assert.equal(sample(), 0);
  gpio.drive(5, true, "pointer:1");
  assert.equal(sample(), 1);
  gpio.drive(5, true, "keyboard");
  gpio.drive(5, false, "pointer:1");
  assert.equal(sample(), 0); // keyboard still holds GPIO high
  for (let i = 0; i < 100; i++) assert.equal(sample(), 0);
  gpio.release();
  assert.equal(sample(), 0);
  gpio.drive(5, true, "pointer:1");
  gpio.drive(8, true, "pointer:2");
  assert.equal(sample(), 3);
  assert.deepEqual(wasm.buzzerPattern("key"), [[3136, 22]]);
  assert.deepEqual(wasm.buzzerPattern("accepted"), [
    [2093, 45],
    [0, 25],
    [2637, 45],
    [0, 25],
    [3136, 75],
  ]);
  assert.deepEqual(wasm.buzzerPattern("error"), [
    [1760, 55],
    [0, 25],
    [1568, 80],
  ]);
});

test("GPIO 44 exposes PWM phase, silence and sequential firmware tones", () => {
  const gpio = new VirtualGpio();
  gpio.playPwm(
    [
      [4000, 60],
      [0, 60],
      [4000, 60],
    ],
    100,
  );
  assert.equal(gpio.read(44, 100), true);
  assert.equal(gpio.read(44, 100.125), false); // half of a 250 µs period
  assert.equal(gpio.read(44, 100.25), true);
  assert.equal(gpio.read(44, 160), false);
  assert.equal(gpio.read(44, 219), false);
  assert.equal(gpio.read(44, 220), true);
  assert.equal(gpio.read(44, 280), false);
  assert.throws(() => gpio.drive(44, true, "external"));
});

test("audio resumes on activation, reproduces PWM timing, and releases nodes on mute", async () => {
  const events: {
    hz: number;
    start?: number;
    stop?: number;
    disconnected?: boolean;
    type?: string;
  }[] = [];
  const audio = {
    state: "suspended",
    currentTime: 10,
    destination: {},
    async resume() {
      this.state = "running";
    },
    async close() {
      this.state = "closed";
    },
    createGain: () => ({
      gain: { value: 0, setValueAtTime() {} },
      connect() {},
      disconnect() {},
    }),
    createOscillator: () => {
      const event: (typeof events)[number] = { hz: 0 };
      events.push(event);
      return {
        frequency: {
          set value(hz: number) {
            event.hz = hz;
          },
        },
        set type(type: string) {
          event.type = type;
        },
        connect() {},
        disconnect() {
          event.disconnected = true;
        },
        start(at: number) {
          event.start = at;
        },
        stop(at?: number) {
          event.stop = at;
        },
        onended: null,
      };
    },
  };
  const buzzer = new VirtualBuzzer(() => audio as unknown as AudioContext);
  assert.equal(buzzer.play([[4000, 40]]), false);
  assert.equal(await buzzer.unlock(), true);
  assert.equal(
    buzzer.play([
      [4000, 60],
      [0, 60],
      [4000, 60],
    ]),
    true,
  );
  assert.deepEqual(
    events.map((e) => [e.hz, e.type]),
    [
      [4000, "square"],
      [4000, "square"],
    ],
  );
  assert.equal(events[0].start, 10);
  assert(Math.abs(events[1].start! - 10.12) < 1e-6);
  assert(Math.abs(events[1].stop! - 10.18) < 1e-6);
  buzzer.setEnabled(false);
  assert(events.every((e) => e.disconnected));
  assert.equal(buzzer.play([[1000, 300]]), false);
  buzzer.dispose();
  assert.equal(audio.state, "closed");
});
