/**
 * The terminal, emulated: the engine session wired like the real XIAO ESP32-S3 board.
 * Touch keys drive GPIO 5 and 8 and are sampled every 20 ms through the board's Rust edge
 * detector; beeps play the board's LEDC programs on GPIO 44; the panel refreshes like
 * e-paper: changed windows refresh partially; a full refresh only at power-on, on `reboot`
 * and on a polarity change. Data updates never flash the whole panel.
 */
import { flipped, refreshKind } from "./refresh";
import type { Effect, Engine, Frame, Pin, Tone } from "../preview/engine";
import { VirtualBuzzer } from "./buzzer";
import { VirtualGpio } from "./gpio";

export const KEY_POLL_MS = 20;
export const KEY_PINS = { left: 5, right: 8 } as const;
export const BUZZER_PIN = 44;
/** Panel timings, from the 7.5" datasheet: what BUSY shows while the panel draws. */
export const REFRESH_MS = { partial: 300, full: 2000 } as const;

export type Refresh = {
  kind: "full" | "partial";
  /** Changed window in panel pixels, byte-aligned horizontally like the firmware's. */
  box: { x: number; y: number; width: number; height: number };
  at: number;
};
export type LogEntry = {
  at: number;
  kind: "input" | "beep" | "emit" | "fetch" | "refresh" | "error" | "info";
  text: string;
};
/** PN532 on I2C 0x24, as wired on the terminal. */
export const NFC = { bus: "I2C", address: 0x24, sda: 41, scl: 42 } as const;
export type BoardHost = {
  frame(frame: Frame, refresh: Refresh): void;
  log(entry: LogEntry): void;
  /** An app event (`emit`): the host's business logic, or the studio's preview flow. */
  emit?(name: string): void;
  /** Answer an app's resource fetch; `undefined` leaves the resource as cached. */
  fetch(id: string, path: string): Promise<unknown> | unknown;
  /** PNG bytes (base64) for a web image, if the host has one. */
  image?(src: string): Promise<string | undefined> | string | undefined;
};

export class EmulatedBoard {
  readonly gpio = new VirtualGpio();
  readonly buzzer = new VirtualBuzzer();
  readonly pins: Pin[];
  private last: Frame | null = null;
  private fullNext = false;
  private busyUntil = 0;
  private nfcUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = performance.now();
  private inverted = false;
  /** Nothing reaches the engine until an app is loaded, nor after it failed (a panic resets the instance). */
  private loaded = false;

  constructor(
    readonly engine: Engine,
    private readonly host: BoardHost,
  ) {
    this.pins = engine.pins();
  }

  /**
   * Load bytecode; `cache` restores data, navigation and local state. The panel keeps its
   * pixels and only the changed window refreshes, unless `reboot` asks for a full refresh.
   */
  load(
    bytecode: Uint8Array,
    {
      cache,
      device,
      data,
      reboot = false,
    }: { cache?: unknown; device?: Record<string, unknown>; data?: Record<string, unknown>; reboot?: boolean } = {},
  ): void {
    if (reboot) this.fullNext = true;
    this.loaded = false;
    this.engine.session.load(bytecode);
    if (cache) this.engine.session.restore(cache);
    if (device) this.engine.session.device(device);
    if (data) this.engine.session.data(data);
    this.loaded = true;
    this.started = performance.now();
    this.run(() => this.engine.session.tick(0));
  }

  /** Swap in rebuilt bytecode and keep everything the app had: what a hot reload means on a device. */
  reload(bytecode: Uint8Array, { device, data }: { device?: Record<string, unknown>; data?: Record<string, unknown> } = {}): void {
    if (!this.loaded) return this.load(bytecode, { device, data });
    const cache = this.engine.session.cache();
    this.loaded = false;
    this.engine.session.load(bytecode);
    this.engine.session.restore(cache);
    if (device) this.engine.session.device(device);
    if (data) this.engine.session.data(data);
    this.loaded = true;
    this.run(() => []);
  }

  /** Host binding roots drawn over the app's data (`view`, `$device` of host-driven screens). */
  hostData(data: Record<string, unknown>): void {
    if (this.loaded) this.run(() => (this.engine.session.data(data), []));
  }

  /** An app is running. */
  get ready(): boolean {
    return this.loaded;
  }

  start(): void {
    this.timer ??= setInterval(() => this.poll(), KEY_POLL_MS);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.gpio.release();
    this.buzzer.stop();
  }

  /** Finger on or off a TTP223 pad. */
  touch(side: keyof typeof KEY_PINS, down: boolean, source = "pointer"): void {
    this.gpio.drive(KEY_PINS[side], down, source);
  }
  /** A tap on the panel, in panel pixels; the engine maps it to the app's coordinates. */
  tap(x: number, y: number): void {
    if (!this.loaded) return;
    this.log("input", `tap ${Math.floor(x)} ${Math.floor(y)}`);
    this.run(() => this.engine.session.press(Math.floor(x), Math.floor(y)));
  }
  /**
   * A badge on the reader: the UID goes to `$device.nfc`, then the `badge` input fires.
   * Returns false when no control of the app is bound to it (the host handles badges itself).
   */
  badge(uid: string, info: Record<string, unknown>): boolean {
    if (!this.loaded) return false;
    this.nfcUntil = performance.now() + 120;
    this.log("input", `badge · PN532 0x24 · UID ${uid}`);
    let bound = false;
    this.run(() => {
      this.engine.session.device(info);
      const effects = this.engine.session.input("badge");
      bound = effects !== null;
      return effects ?? [];
    });
    return bound;
  }
  device(info: Record<string, unknown>): void {
    if (this.loaded) this.run(() => (this.engine.session.device(info) === 1 ? [] : null));
  }
  /** Reflect polarity changes: the panel needs a full refresh to clear ghosting. */
  setInverted(inverted: boolean): void {
    if (inverted !== this.inverted) this.fullNext = true;
    this.inverted = inverted;
  }

  /** Level of any wired pin right now, for the pinout view. */
  level(gpio: number, now = performance.now()): boolean {
    if (gpio === KEY_PINS.left || gpio === KEY_PINS.right || gpio === BUZZER_PIN) return this.gpio.read(gpio, now);
    if (gpio === 3) return now < this.busyUntil; // BUSY
    if (gpio === NFC.sda || gpio === NFC.scl) return now < this.nfcUntil && Math.floor(now / 8) % 2 === (gpio & 1); // I2C traffic
    return false;
  }
  /** The panel is still drawing (BUSY high). */
  busy(now = performance.now()): boolean {
    return now < this.busyUntil;
  }
  redraw(): void {
    if (this.loaded) this.run(() => []);
  }

  /** Feed the engine's answer to `settle`; an engine failure stops the app instead of repeating every poll. */
  private run(step: () => Effect[] | null): void {
    try {
      const effects = step();
      if (effects) void this.settle(effects).catch((error) => this.fail(error));
    } catch (error) {
      this.fail(error);
    }
  }
  private fail(error: unknown): void {
    this.loaded = false;
    this.log("error", `${error instanceof Error ? error.message : String(error)} · app arrêtée`);
  }

  private levels = { left: false, right: false };
  private poll(): void {
    if (!this.loaded) return;
    const now = performance.now();
    const left = this.gpio.sample(KEY_PINS.left, now);
    const right = this.gpio.sample(KEY_PINS.right, now);
    // The Rust detector decides what an edge is; this only logs what the pins did.
    for (const [side, level] of [["left", left], ["right", right]] as const) {
      if (level && !this.levels[side]) this.log("input", `touche ${side === "left" ? "gauche" : "droite"} · GPIO ${KEY_PINS[side]} ↑`);
      this.levels[side] = level;
    }
    this.run(() => [...this.engine.session.gpio(left, right, now - this.started), ...this.engine.session.tick(now - this.started)]);
  }

  private async settle(effects: Effect[]): Promise<void> {
    for (const effect of effects) {
      if (effect.kind === "beep") this.beep(effect.tone);
      else if (effect.kind === "emit") {
        this.log("emit", effect.name);
        this.host.emit?.(effect.name);
      }
      else if (effect.kind === "fetch") {
        const value = await this.host.fetch(effect.id, effect.path);
        if (value === undefined) this.log("fetch", `${effect.path} → pas de données simulées`);
        else {
          this.engine.session.update(effect.id, value);
          this.log("fetch", `${effect.path} → ${effect.id}`);
        }
      }
    }
    for (const request of this.engine.session.images()) {
      const png = await this.host.image?.(request.src);
      if (png) this.engine.session.image(request.src, png);
    }
    this.present();
  }

  private beep(tone: Tone): void {
    const program = this.engine.tone(tone);
    this.gpio.playPwm(program, performance.now());
    this.buzzer.play(program);
    this.log("beep", `${tone} · ${program.filter(([hz]) => hz).map(([hz, ms]) => `${hz} Hz ${ms} ms`).join(", ")}`);
  }

  /** Pixels partial refreshes turned since the last full one: their ghosting adds up. */
  private ghost = 0;
  private present(): void {
    const frame = this.engine.session.render();
    const box = !this.last || this.fullNext ? full(frame) : changed(this.last, frame);
    if (!box) return;
    // As on the terminal: a new screen flashes once (fast full refresh), an update does not.
    const turned = this.last ? flipped(this.last.bits, frame.bits) : 0;
    const kind = !this.last || this.fullNext ? "full" : refreshKind(turned, this.ghost, frame.width, frame.height);
    this.ghost = kind === "full" ? 0 : this.ghost + turned;
    this.fullNext = false;
    const at = performance.now();
    this.busyUntil = at + REFRESH_MS[kind];
    this.last = frame;
    const refresh = { kind, box: kind === "full" ? full(frame) : box, at } as const;
    this.log("refresh", `${kind} ${refresh.box.width}×${refresh.box.height} @ ${refresh.box.x},${refresh.box.y}`);
    this.host.frame(frame, refresh);
  }

  private log(kind: LogEntry["kind"], text: string): void {
    this.host.log({ at: performance.now(), kind, text });
  }
}

function full(frame: Frame): Refresh["box"] {
  return { x: 0, y: 0, width: frame.width, height: frame.height };
}

/** One byte-aligned window around every changed pixel, as `ui/src/frame.rs` computes it. */
export function changed(before: Frame, after: Frame): Refresh["box"] | null {
  if (before.width !== after.width || before.height !== after.height) return full(after);
  const row = Math.ceil(after.width / 8);
  let top = -1;
  let bottom = -1;
  let left = row;
  let right = -1;
  for (let y = 0; y < after.height; y++)
    for (let b = 0; b < row; b++)
      if (before.bits[y * row + b] !== after.bits[y * row + b]) {
        if (top < 0) top = y;
        bottom = y;
        left = Math.min(left, b);
        right = Math.max(right, b);
      }
  if (top < 0) return null;
  return {
    x: left * 8,
    y: top,
    width: Math.min(after.width, (right + 1) * 8) - left * 8,
    height: bottom - top + 1,
  };
}
