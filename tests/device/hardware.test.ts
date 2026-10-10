import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BUZZER_PIN, VirtualBuzzer, VirtualGpio } from "@matecrew/device-ui/emulator";
import { DeviceWasm } from "../../src/lib/device/virtual/wasm";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("virtual GPIO levels pass through the firmware's Rust key detector", async () => {
  const bytes = await readFile(
    new URL("../../public/device/matecrew.wasm", import.meta.url),
  );
  globalThis.fetch = (async () =>
    new Response(bytes, {
      headers: { "Content-Type": "application/wasm" },
    })) as typeof fetch;
  const wasm = await DeviceWasm.load();
  const gpio = new VirtualGpio();
  // The runtime polls every 20 ms: 1 left, 2 right, 4 both keys, 0 nothing (yet).
  let now = 0;
  const sample = () => wasm.sampleGpio(gpio.read(5), gpio.read(8), (now += 20));
  /** What the next polls report, within the 120 ms the other key has to join. */
  const settle = (poll = sample) => {
    for (let i = 0; i < 8; i++) {
      const mask = poll();
      if (mask) return mask;
    }
    return 0;
  };
  assert.equal(sample(), 0);
  gpio.drive(5, true, "pointer:1");
  assert.equal(sample(), 0); // the right key may still join
  assert.equal(settle(), 1);
  gpio.drive(5, true, "keyboard");
  gpio.drive(5, false, "pointer:1");
  assert.equal(settle(), 0); // keyboard still holds GPIO high
  for (let i = 0; i < 100; i++) assert.equal(sample(), 0);
  gpio.release();
  assert.equal(sample(), 0);
  gpio.drive(5, true, "pointer:1");
  gpio.drive(8, true, "pointer:2");
  assert.equal(sample(), 4); // both keys together: the about page
  gpio.release();
  assert.equal(settle(), 0);
  gpio.drive(8, true, "pointer:2");
  assert.equal(sample(), 0);
  assert.equal(sample(), 0);
  gpio.drive(5, true, "pointer:1");
  assert.equal(sample(), 4); // 40 ms apart is still together
  gpio.release();
  assert.equal(settle(), 0);
  // A tap shorter than the 20 ms poll still reaches the detector once.
  const poll = () => wasm.sampleGpio(gpio.sample(5), gpio.sample(8), (now += 20));
  gpio.drive(8, true, "keyboard");
  gpio.drive(8, false, "keyboard");
  assert.equal(gpio.read(8), false);
  assert.equal(settle(poll), 2);
  assert.equal(settle(poll), 0);
  assert.deepEqual(wasm.buzzerPattern("key"), [
    [2637, 18],
    [3136, 12],
  ]);
  assert.deepEqual(wasm.buzzerPattern("accepted"), [
    [2093, 55],
    [2637, 55],
    [3136, 55],
    [4186, 90],
    [0, 40],
    [3136, 55],
    [4186, 170],
  ]);
  assert.deepEqual(wasm.buzzerPattern("badge"), [
    [2093, 26],
    [2637, 26],
    [3136, 26],
    [4186, 90],
  ]);
  assert.deepEqual(wasm.buzzerPattern("error"), [
    [1976, 70],
    [0, 25],
    [1865, 70],
    [0, 25],
    [1760, 70],
    [0, 25],
    [1661, 220],
  ]);
  assert.equal(wasm.buzzerPattern("unknown").at(-1)?.[0], 3951);
  assert.equal(wasm.buzzerPattern("boot").length, 10);
});

test("the buzzer pin exposes PWM phase, silence and sequential firmware tones", () => {
  const gpio = new VirtualGpio();
  gpio.playPwm(
    [
      [4000, 60],
      [0, 60],
      [4000, 60],
    ],
    100,
  );
  assert.equal(gpio.read(BUZZER_PIN, 100), true);
  assert.equal(gpio.read(BUZZER_PIN, 100.125), false); // half of a 250 µs period
  assert.equal(gpio.read(BUZZER_PIN, 100.25), true);
  assert.equal(gpio.read(BUZZER_PIN, 160), false);
  assert.equal(gpio.read(BUZZER_PIN, 219), false);
  assert.equal(gpio.read(BUZZER_PIN, 220), true);
  assert.equal(gpio.read(BUZZER_PIN, 280), false);
  assert.throws(() => gpio.drive(BUZZER_PIN, true, "external"));
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
