/** The device engine compiled to WebAssembly: a frame here is pixel for pixel what the panel shows. Works in Bun and browsers. */

export type PreviewEvent =
  | { kind: "press"; x: number; y: number }
  | { kind: "input"; name: string }
  | { kind: "action"; id: string }
  | { kind: "tick"; ms: number }
  | { kind: "notify"; message: string; durationMs?: number };

/** The state to draw a scene in. Applied in order: cache, device, events, then `data` overlays. */
export type PreviewSpec = {
  /** Offline-cache shape: resources by id, `local` state, `$navigation: { stack }`, `$images`. */
  cache?: Record<string, unknown>;
  /** Host metadata, read through `$device.*`. */
  device?: Record<string, unknown>;
  /** Binding roots set directly, e.g. `view` for screens a host drives. */
  data?: Record<string, unknown>;
  events?: PreviewEvent[];
  theme?: "flipper" | "macos" | "dark";
  /** Panel the app is fitted on, 800 × 480 by default. */
  panel?: [number, number];
  /** Web images by `src`. In preview files: a PNG path relative to that file; the CLI sends base64. */
  images?: Record<string, string>;
};

/** Packed 1-bit pixels: MSB first, 1 = ink, rows padded to whole bytes. */
export type Frame = {
  width: number;
  height: number;
  bits: Uint8Array;
  effects: Effect[];
};

/** What an app asks its host to do. */
export type Effect =
  | { kind: "fetch"; id: string; path: string }
  | { kind: "emit"; name: string }
  | { kind: "beep"; tone: Tone };
export type Tone = "key" | "success" | "error" | "notification";
export type ImageRequest = { src: string; width: number; height: number; cover: boolean };
export type Pin = {
  pad: string;
  gpio: number;
  function: string;
  signal: "panel" | "key" | "buzzer" | "i2c" | "adc" | "free";
};

type Exports = {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  preview(dui: number, duiLen: number, spec: number, specLen: number): number;
  output_ptr(): number;
  output_len(): number;
  effects_ptr(): number;
  effects_len(): number;
  frame_width(): number;
  frame_height(): number;
  session_load(ptr: number, len: number): number;
  session_restore(ptr: number, len: number): number;
  session_device(ptr: number, len: number): number;
  session_update(ptr: number, len: number): number;
  session_gpio(left: number, right: number, nowMs: number): number;
  session_press(x: number, y: number): number;
  session_input(ptr: number, len: number): number;
  session_data(ptr: number, len: number): number;
  session_action(ptr: number, len: number): number;
  session_tick(nowMs: number): number;
  session_render(): number;
  session_cache(): number;
  session_images(): number;
  session_image(ptr: number, len: number): number;
  tone(ptr: number, len: number): number;
  pins(): number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Engine {
  private constructor(
    private readonly module: WebAssembly.Module,
    private wasm: Exports,
  ) {}

  static async fromBytes(bytes: BufferSource): Promise<Engine> {
    const compiled = await WebAssembly.compile(bytes);
    return new Engine(compiled, (await WebAssembly.instantiate(compiled, {})).exports as unknown as Exports);
  }

  /** Stateless: draw `bytecode` in the state `spec` describes. */
  render(bytecode: Uint8Array, spec: PreviewSpec = {}): Frame {
    return this.guard(() => {
      const json = encoder.encode(JSON.stringify(spec));
      this.check(this.wasm.preview(this.write(bytecode), bytecode.length, this.write(json), json.length));
      return {
        ...this.frame(),
        effects: JSON.parse(
          decoder.decode(new Uint8Array(this.wasm.memory.buffer, this.wasm.effects_ptr(), this.wasm.effects_len())),
        ),
      };
    });
  }

  /** The emulator's running app (one per engine instance). */
  readonly session = {
    load: (bytecode: Uint8Array) =>
      this.guard(() => {
        this.check(this.wasm.session_load(this.write(bytecode), bytecode.length));
      }),
    restore: (cache: unknown) => this.json("session_restore", cache),
    device: (info: Record<string, unknown>) => this.json("session_device", info),
    update: (id: string, value: unknown) => this.json("session_update", { id, value }),
    /** Binding roots drawn over the app's own data, e.g. `view` for host-driven screens. */
    data: (data: Record<string, unknown>) => this.json("session_data", data),
    /**
     * Sample the key pins (GPIO 5, GPIO 8) through the board's edge detector: key levels at
     * `nowMs`; a key comes out when released, `leftLong` / `rightLong` once held 700 ms (the
     * short one, its emit renamed, where the app has no such input), both keys as `emit("both")`.
     */
    gpio: (left: boolean, right: boolean, nowMs: number) =>
      this.guard(() => this.effects(this.wasm.session_gpio(Number(left), Number(right), nowMs))),
    /** A tap in panel pixels. */
    press: (x: number, y: number) => this.guard(() => this.effects(this.wasm.session_press(x, y))),
    action: (id: string) =>
      this.guard(() => {
        const bytes = encoder.encode(id);
        return this.effects(this.wasm.session_action(this.write(bytes), bytes.length));
      }),
    /** A named hardware input (`badge`, `left`…); `null` when no control is bound to it. */
    input: (name: string): Effect[] | null =>
      this.guard(() => {
        const bytes = encoder.encode(name);
        return this.effects(this.wasm.session_input(this.write(bytes), bytes.length));
      }),
    tick: (nowMs: number) => this.guard(() => this.effects(this.wasm.session_tick(nowMs))),
    render: (): Frame =>
      this.guard(() => {
        this.check(this.wasm.session_render());
        return { ...this.frame(), effects: [] };
      }),
    cache: (): Record<string, unknown> => this.guard(() => JSON.parse(this.text(this.check(this.wasm.session_cache())))),
    images: (): ImageRequest[] => this.guard(() => JSON.parse(this.text(this.check(this.wasm.session_images())))),
    image: (src: string, png: string) => this.json("session_image", { src, png }) === 1,
  };

  /** The board's LEDC program for a tone, as `[hz, ms]` steps. */
  tone(tone: Tone): [number, number][] {
    return this.guard(() => {
      const bytes = encoder.encode(tone);
      return JSON.parse(this.text(this.check(this.wasm.tone(this.write(bytes), bytes.length))));
    });
  }

  /** The board's wiring. */
  pins(): Pin[] {
    return this.guard(() => JSON.parse(this.text(this.check(this.wasm.pins()))));
  }

  private guard<T>(run: () => T): T {
    try {
      return run();
    } catch (error) {
      // A Rust panic aborts and leaves the instance unusable; start a fresh one for the next call.
      if (error instanceof WebAssembly.RuntimeError)
        this.wasm = new WebAssembly.Instance(this.module, {}).exports as unknown as Exports;
      throw error;
    }
  }
  private write(bytes: Uint8Array): number {
    const ptr = this.wasm.alloc(bytes.length);
    new Uint8Array(this.wasm.memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  }
  private output(): Uint8Array {
    return new Uint8Array(this.wasm.memory.buffer, this.wasm.output_ptr(), this.wasm.output_len()).slice();
  }
  private text(_length: number): string {
    return decoder.decode(this.output());
  }
  private check(result: number): number {
    if (result < 0) throw new Error(decoder.decode(this.output()));
    return result;
  }
  private effects(result: number): Effect[] {
    // `null` from session_input: nothing bound.
    return JSON.parse(this.text(this.check(result)));
  }
  private json(
    name: "session_restore" | "session_device" | "session_update" | "session_image" | "session_data",
    value: unknown,
  ): number {
    return this.guard(() => {
      const bytes = encoder.encode(JSON.stringify(value));
      return this.check(this.wasm[name](this.write(bytes), bytes.length));
    });
  }
  private frame(): Omit<Frame, "effects"> {
    return { width: this.wasm.frame_width(), height: this.wasm.frame_height(), bits: this.output() };
  }
}

/** Is the pixel at (x, y) ink? */
export function ink(frame: Pick<Frame, "width" | "bits">, x: number, y: number): boolean {
  const row = Math.ceil(frame.width / 8);
  return (frame.bits[y * row + (x >> 3)] & (128 >> (x & 7))) !== 0;
}
