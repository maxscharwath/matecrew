/**
 * The terminal's take flow and screens, compiled from device/web to
 * WebAssembly (`just web` writes public/device/matecrew.wasm). Plain exports
 * and JSON, no generated bindings.
 */
import type {
  DeviceState,
  DeviceTake,
  DeviceScreen,
  DeviceTheme,
} from "@/lib/device/contract";

export const WASM_URL = "/device/matecrew.wasm";

export type Side = "left" | "right";

export type FlowScreen =
  | { type: "main" }
  | { type: "badge"; keyLabel: string }
  | {
      type: "pick";
      name: string;
      item: string;
      stock: number;
      image: string;
      index: number;
      count: number;
    }
  | { type: "leave"; name: string }
  | { type: "taken"; name: string; item: string; image: string }
  | {
      type: "summary";
      name: string;
      today: number;
      week: number;
      month: number;
    }
  | { type: "unknownBadge"; uid: string; claimUrl: string | null }
  | { type: "notReady" }
  | { type: "noItems" }
  | { type: "about" }
  | { type: "served"; name: string; count: number };

export type FlowEvent =
  | { type: "key"; side: Side }
  | { type: "bothKeys" }
  | { type: "badge"; uid: string }
  | { type: "tick" };

export type Beep = "key" | "accepted" | "error" | "notification" | "badge" | "boot" | "unknown";

export type Effect =
  | { type: "show"; screen: FlowScreen }
  | { type: "beep"; beep: Beep }
  | { type: "queue"; take: DeviceTake }
  | { type: "noteUnknownBadge"; uid: string }
  /** "Servi" and a runner's badge: serve the preparation's session now. */
  | { type: "serve"; uid: string; name: string; sessionId: string | null };

/** Screens the terminal draws itself, outside the take flow. */
export type View =
  | { type: "boot"; stage: number }
  | { type: "main"; state: DeviceState; offline: boolean }
  | { type: "dashboard"; data: DeviceScreen; offline: boolean }
  | { type: "connecting"; ssid: string }
  | { type: "link"; code: string; url: string; urlWithCode: string }
  | { type: "linked"; office: string; name: string }
  | { type: "error"; title: string; detail: string }
  | { type: "flow"; screen: FlowScreen };

export type ImageRequest = {
  src: string;
  width: number;
  height: number;
  cover: boolean;
};

export type AppEffect =
  | { kind: "fetch"; id: string; path: string }
  | { kind: "emit"; name: string }
  | { kind: "beep"; tone: "key" | "success" | "error" | "notification" | "badge" };

interface Exports {
  gpio_sample(left: number, right: number, nowMs: number): number;
  buzzer_pattern(tone: number): number;
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  render(ptr: number, len: number): number;
  frame_ptr(): number;
  frame_len(): number;
  set_state(ptr: number, len: number): number;
  handle(ptr: number, len: number): number;
  output_ptr(): number;
  deadline(): number;
  reset(): void;
  set_theme(theme: number): void;
  load_app(ptr: number, len: number): number;
  load_showcase(): number;
  app_device(ptr: number, len: number): number;
  app_advance(ptr: number, len: number): number;
  app_update(ptr: number, len: number): number;
  app_action(ptr: number, len: number): number;
  app_render(scale: number): number;
  app_press(x: number, y: number): number;
  app_tick(nowMs: number): number;
  app_overlay_deadline(): number;
  system_notify(ptr: number, len: number): number;
  app_input(ptr: number, len: number): number;
  app_cache(): number;
  app_images(): number;
  app_image(
    requestPtr: number,
    requestLen: number,
    ptr: number,
    len: number,
  ): number;
  app_restore(ptr: number, len: number): number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class DeviceWasm {
  private constructor(private readonly exports: Exports) {}

  static async load(url = WASM_URL): Promise<DeviceWasm> {
    const { instance } = await WebAssembly.instantiateStreaming(
      fetch(url, { cache: "no-store" }),
    );
    return new DeviceWasm(instance.exports as unknown as Exports);
  }

  /** Change typography and monochrome styling without recompiling screen definitions. */
  setTheme(theme: DeviceTheme): void {
    this.exports.set_theme({ flipper: 0, macos: 1, dark: 2, paper: 3 }[theme] ?? 3);
  }

  /** Draws a screen and returns a copy of the 48 000-byte frame. */
  render(view: View): Uint8Array {
    if (this.call("render", view) !== 0)
      throw new Error(`render: bad view ${JSON.stringify(view)}`);
    const { memory, frame_ptr, frame_len } = this.exports;
    return new Uint8Array(memory.buffer, frame_ptr(), frame_len()).slice();
  }

  /** Load the compact TSX compiler output; layout never travels as JSON. */
  loadApp(bytecode: Uint8Array): void {
    const ptr = this.exports.alloc(bytecode.length);
    new Uint8Array(this.exports.memory.buffer, ptr, bytecode.length).set(
      bytecode,
    );
    if (this.exports.load_app(ptr, bytecode.length) !== 0)
      throw new Error("Unsupported or damaged device bytecode");
  }

  setDeviceInfo(info: unknown): void {
    if (this.call("app_device", info) < 0)
      throw new Error("Load an app before providing device info");
  }
  loadShowcase(): void {
    if (this.exports.load_showcase() !== 0)
      throw new Error("Invalid bundled Showcase app");
  }

  imageRequests(): ImageRequest[] {
    const len = this.exports.app_images();
    if (len < 0) throw new Error("Load an app before requesting images");
    return JSON.parse(
      decoder.decode(
        new Uint8Array(
          this.exports.memory.buffer,
          this.exports.output_ptr(),
          len,
        ),
      ),
    ) as ImageRequest[];
  }

  updateImage(request: ImageRequest, bytes: Uint8Array): boolean {
    const json = encoder.encode(JSON.stringify(request));
    const requestPtr = this.exports.alloc(json.length);
    new Uint8Array(this.exports.memory.buffer, requestPtr, json.length).set(
      json,
    );
    const ptr = this.exports.alloc(bytes.length);
    new Uint8Array(this.exports.memory.buffer, ptr, bytes.length).set(bytes);
    const result = this.exports.app_image(
      requestPtr,
      json.length,
      ptr,
      bytes.length,
    );
    if (result < 0) throw new Error("Invalid, oversized or stale PNG image");
    return result === 1;
  }

  renderApp(scale = 0): Uint8Array {
    if (this.exports.app_render(scale) !== 0)
      throw new Error("Load device bytecode before rendering");
    return new Uint8Array(
      this.exports.memory.buffer,
      this.exports.frame_ptr(),
      this.exports.frame_len(),
    ).slice();
  }

  inputApp(input: string): AppEffect[] | null {
    const len = this.call("app_input", input);
    if (len === -2) return null;
    if (len < 0) throw new Error("Load an app before sending hardware input");
    return JSON.parse(
      decoder.decode(
        new Uint8Array(
          this.exports.memory.buffer,
          this.exports.output_ptr(),
          len,
        ),
      ),
    ) as AppEffect[];
  }
  /** 1 the left key, 2 the right one, 4 both together (the about page), 0 nothing yet. */
  sampleGpio(left: boolean, right: boolean, nowMs: number): number {
    return this.exports.gpio_sample(Number(left), Number(right), nowMs);
  }
  buzzerPattern(beep: Beep): [hz: number, ms: number][] {
    const len = this.exports.buzzer_pattern(
      beep === "accepted"
        ? 1
        : beep === "error"
          ? 2
          : beep === "notification"
            ? 3
            : beep === "badge"
              ? 4
              : beep === "unknown"
                ? 5
                : beep === "boot"
                  ? 6
                  : 0,
    );
    return JSON.parse(
      decoder.decode(
        new Uint8Array(
          this.exports.memory.buffer,
          this.exports.output_ptr(),
          len,
        ),
      ),
    );
  }
  tickApp(nowMs: number): boolean {
    return this.exports.app_tick(nowMs) === 1;
  }
  notify(message: string, durationMs: number, nowMs: number): boolean {
    return (
      this.call("system_notify", {
        message,
        durationMs,
        nowMs: Math.floor(nowMs),
      }) === 1
    );
  }
  overlayDeadline(): number | null {
    const deadline = this.exports.app_overlay_deadline();
    return deadline < 0 ? null : deadline;
  }

  pressApp(x: number, y: number): AppEffect[] {
    const len = this.exports.app_press(x, y);
    if (len < 0) throw new Error("Load device bytecode before sending input");
    return JSON.parse(
      decoder.decode(
        new Uint8Array(
          this.exports.memory.buffer,
          this.exports.output_ptr(),
          len,
        ),
      ),
    ) as AppEffect[];
  }
  cacheApp(): Record<string, unknown> {
    const len = this.exports.app_cache();
    if (len < 0)
      throw new Error("Load device bytecode before reading its cache");
    return JSON.parse(
      decoder.decode(
        new Uint8Array(
          this.exports.memory.buffer,
          this.exports.output_ptr(),
          len,
        ),
      ),
    ) as Record<string, unknown>;
  }
  restoreApp(cache: unknown): void {
    if (this.call("app_restore", cache) !== 0)
      throw new Error("Load device bytecode before restoring a cache");
  }
  advanceApp(nowMs: number, onWake = false): AppEffect[] {
    return this.appEffects("app_advance", { nowMs, onWake });
  }
  updateApp(id: string, value: unknown): boolean {
    const result = this.call("app_update", { id, value });
    if (result < 0)
      throw new Error("Load device bytecode before updating resources");
    return result === 1;
  }
  actionApp(action: string): AppEffect[] {
    return this.appEffects("app_action", { action });
  }
  private appEffects(
    name: "app_advance" | "app_action" | "app_restore",
    value: unknown,
  ): AppEffect[] {
    const len = this.call(name, value);
    if (len < 0)
      throw new Error("Load device bytecode before sending app events");
    return JSON.parse(
      decoder.decode(
        new Uint8Array(
          this.exports.memory.buffer,
          this.exports.output_ptr(),
          len,
        ),
      ),
    ) as AppEffect[];
  }

  setState(state: DeviceState): void {
    if (this.call("set_state", state) !== 0)
      throw new Error("set_state: the state does not match device/core");
  }

  handle(
    event: FlowEvent,
    context: {
      nowMs: number;
      unix: number | null;
      random: number;
      /** The site, and the SHA-256 of the token in hex: signs the link that claims an unknown badge. */
      claim: { site: string; key: string } | null;
    },
  ): Effect[] {
    const len = this.call("handle", { event, ...context });
    if (len < 0) throw new Error(`handle: bad event ${JSON.stringify(event)}`);
    const bytes = new Uint8Array(
      this.exports.memory.buffer,
      this.exports.output_ptr(),
      len,
    );
    return JSON.parse(decoder.decode(bytes)) as Effect[];
  }

  /** In `nowMs` time, or null when the flow is idle. */
  deadline(): number | null {
    const at = this.exports.deadline();
    return at < 0 ? null : at;
  }

  reset(): void {
    this.exports.reset();
  }

  private call(
    name:
      | "render"
      | "set_state"
      | "handle"
      | "app_advance"
      | "app_update"
      | "app_action"
      | "app_restore"
      | "app_input"
      | "app_device"
      | "system_notify",
    value: unknown,
  ): number {
    const json = encoder.encode(JSON.stringify(value));
    const ptr = this.exports.alloc(json.length);
    new Uint8Array(this.exports.memory.buffer, ptr, json.length).set(json);
    return this.exports[name](ptr, json.length);
  }
}
