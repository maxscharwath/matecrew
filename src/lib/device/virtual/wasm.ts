/**
 * The terminal's take flow and screens, compiled from device/web to
 * WebAssembly (`just web` writes public/device/matecrew.wasm). Plain exports
 * and JSON, no generated bindings.
 */
import type { DeviceState, DeviceTake } from "@/lib/device/contract";

export const WASM_URL = "/device/matecrew.wasm";

export type Side = "left" | "right";

export type FlowScreen =
  | { type: "main" }
  | { type: "badge"; keyLabel: string }
  | { type: "take"; name: string; keyLabel: string; seconds: number }
  | { type: "unknownBadge"; uid: string }
  | { type: "notReady" };

export type FlowEvent = { type: "key"; side: Side } | { type: "badge"; uid: string } | { type: "tick" };

export type Beep = "key" | "accepted" | "error";

export type Effect =
  | { type: "show"; screen: FlowScreen }
  | { type: "beep"; beep: Beep }
  | { type: "queue"; take: DeviceTake }
  | { type: "noteUnknownBadge"; uid: string };

/** Screens the terminal draws itself, outside the take flow. */
export type View =
  | { type: "test" }
  | { type: "connecting"; ssid: string }
  | { type: "link"; code: string; url: string; urlWithCode: string }
  | { type: "linked"; office: string; name: string }
  | { type: "error"; title: string; detail: string }
  | { type: "flow"; screen: FlowScreen };

interface Exports {
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
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class DeviceWasm {
  private constructor(private readonly exports: Exports) {}

  static async load(url = WASM_URL): Promise<DeviceWasm> {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(url, { cache: "no-store" }));
    return new DeviceWasm(instance.exports as unknown as Exports);
  }

  /** Draws a screen and returns a copy of the 48 000-byte frame. */
  render(view: View): Uint8Array {
    if (this.call("render", view) !== 0) throw new Error(`render: bad view ${JSON.stringify(view)}`);
    const { memory, frame_ptr, frame_len } = this.exports;
    return new Uint8Array(memory.buffer, frame_ptr(), frame_len()).slice();
  }

  setState(state: DeviceState): void {
    if (this.call("set_state", state) !== 0) throw new Error("set_state: the state does not match device/core");
  }

  handle(event: FlowEvent, context: { nowMs: number; unix: number | null; random: number }): Effect[] {
    const len = this.call("handle", { event, ...context });
    if (len < 0) throw new Error(`handle: bad event ${JSON.stringify(event)}`);
    const bytes = new Uint8Array(this.exports.memory.buffer, this.exports.output_ptr(), len);
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

  private call(name: "render" | "set_state" | "handle", value: unknown): number {
    const json = encoder.encode(JSON.stringify(value));
    const ptr = this.exports.alloc(json.length);
    new Uint8Array(this.exports.memory.buffer, ptr, json.length).set(json);
    return this.exports[name](ptr, json.length);
  }
}
