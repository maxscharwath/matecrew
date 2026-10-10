/**
 * A device over Web Bluetooth (Chrome and Edge on Android, Windows, macOS, ChromeOS; not
 * Safari or Firefox). Writes that change something make the browser pair first: its system
 * dialog asks for the passkey the device shows on its screen.
 */
import {
  OTA_ABORT,
  OTA_CHUNK,
  OTA_END,
  UUIDS,
  decodeEvent,
  decodeInfo,
  encodeCommand,
  encodeProvisioning,
  fail,
  imageVersion,
  ok,
  otaBegin,
  otaChunks,
  type DeviceEvent,
  type DeviceInfo,
  type LinkError,
  type Provisioning,
  type RemoteCommand,
  type Result,
} from "./protocol";
import type { DeviceRemote } from "./remote";

/* The part of Web Bluetooth this module uses, typed here rather than through the DOM lib. */
type Characteristic = {
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<Characteristic>;
  stopNotifications(): Promise<Characteristic>;
  value?: DataView | null;
  addEventListener(type: "characteristicvaluechanged", listener: (event: Event) => void): void;
  removeEventListener(type: "characteristicvaluechanged", listener: (event: Event) => void): void;
};
type Service = { getCharacteristic(uuid: string): Promise<Characteristic> };
type Server = { connected: boolean; connect(): Promise<Server>; disconnect(): void; getPrimaryService(uuid: string): Promise<Service> };
type Device = {
  id: string;
  name?: string;
  gatt?: Server;
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
};
type Bluetooth = {
  getAvailability?(): Promise<boolean>;
  requestDevice(options: { filters: { services?: string[]; namePrefix?: string }[]; optionalServices?: string[] }): Promise<Device>;
};

function bluetooth(): Bluetooth | null {
  const nav = (globalThis as { navigator?: { bluetooth?: Bluetooth } }).navigator;
  return nav?.bluetooth ?? null;
}

/** Whether this browser can reach a device over Bluetooth at all. */
export async function isSupported(): Promise<boolean> {
  const api = bluetooth();
  if (!api) return false;
  return api.getAvailability ? api.getAvailability().catch(() => false) : true;
}

/** A Web Bluetooth failure as one of the module's errors. */
function linkError(error: unknown): LinkError {
  const name = (error as { name?: string })?.name ?? "";
  const message = (error as { message?: string })?.message ?? String(error);
  if (name === "NotFoundError") return { code: "cancelled", message };
  if (name === "SecurityError" || name === "NotAllowedError") return { code: "cancelled", message };
  if (name === "NetworkError") return { code: "disconnected", message };
  if (name === "NotSupportedError" && /GATT operation failed|unknown reason/i.test(message)) {
    // An ATT application error: the device refused (its reason comes as a `done` event).
    return { code: "refused", message };
  }
  if (name === "NotSupportedError") return { code: "unsupported", message };
  return { code: "transport", message };
}

async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await run());
  } catch (error) {
    return { ok: false, error: linkError(error) };
  }
}

type Listener = (event: DeviceEvent) => void;

export type ConnectOptions = {
  /** Only devices whose name starts with this, besides the service filter. */
  namePrefix?: string;
};

export type UpdateOptions = {
  /** Called after each frame with the bytes the device acknowledged. */
  onProgress?: (done: number, total: number) => void;
  /** Firmware bytes per frame; at most 503. */
  chunk?: number;
  /** Stops the upload (the device drops the partial image). */
  signal?: AbortSignal;
};

/** A connected device. Get one with `BleDevice.request()`. */
export class BleDevice implements DeviceRemote {
  readonly transport = "ble";
  private readonly listeners = new Set<Listener>();
  private readonly closers = new Set<() => void>();
  private chars: Partial<Record<keyof typeof UUIDS, Characteristic>> = {};
  private subscribed = false;

  private constructor(private readonly device: Device) {
    device.addEventListener("gattserverdisconnected", () => {
      this.chars = {};
      this.subscribed = false;
      for (const close of this.closers) close();
    });
  }

  /**
   * Lets the person pick a device in the browser's chooser (needs a click or key press), then
   * connects. Filters on the link service, so only compatible devices show.
   */
  static async request(options: ConnectOptions = {}): Promise<Result<BleDevice>> {
    const api = bluetooth();
    if (!api) return fail("unsupported", "this browser has no Web Bluetooth");
    const picked = await attempt(() =>
      api.requestDevice({
        filters: [{ services: [UUIDS.service], ...(options.namePrefix ? { namePrefix: options.namePrefix } : {}) }],
        optionalServices: [UUIDS.service],
      }),
    );
    if (!picked.ok) return picked;
    const device = new BleDevice(picked.value);
    const connected = await device.connect();
    return connected.ok ? ok(device) : connected;
  }

  get name(): string {
    return this.device.name ?? "";
  }

  get connected(): boolean {
    return this.device.gatt?.connected ?? false;
  }

  /** Connects again after `disconnect`, or after the device restarted. */
  async connect(): Promise<Result<void>> {
    const gatt = this.device.gatt;
    if (!gatt) return fail("not-found", "the device has no GATT server");
    return attempt(async () => {
      const server = await gatt.connect();
      const service = await server.getPrimaryService(UUIDS.service);
      for (const key of Object.keys(UUIDS) as (keyof typeof UUIDS)[]) {
        if (key !== "service") this.chars[key] = await service.getCharacteristic(UUIDS[key]);
      }
    });
  }

  disconnect(): void {
    this.device.gatt?.disconnect();
  }

  /** Called when the link drops (the device restarted, went out of range, `disconnect`). */
  onDisconnect(listener: () => void): () => void {
    this.closers.add(listener);
    return () => this.closers.delete(listener);
  }

  private characteristic(key: keyof typeof UUIDS): Result<Characteristic> {
    const found = this.chars[key];
    return found ? ok(found) : fail("disconnected", "not connected");
  }

  async info(): Promise<Result<DeviceInfo>> {
    const info = this.characteristic("info");
    if (!info.ok) return info;
    const read = await attempt(() => info.value.readValue());
    if (!read.ok) return read;
    return decodeInfo(new Uint8Array(read.value.buffer, read.value.byteOffset, read.value.byteLength));
  }

  /**
   * Events the device notifies once paired: its log, answers, update progress. Subscribing pairs
   * if needed. Returns a function that stops listening.
   */
  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    void this.subscribe();
    return () => this.listeners.delete(listener);
  }

  private async subscribe(): Promise<Result<void>> {
    if (this.subscribed) return ok(undefined);
    const events = this.characteristic("events");
    if (!events.ok) return events;
    return attempt(async () => {
      events.value.addEventListener("characteristicvaluechanged", (event) => {
        const view = (event.target as unknown as Characteristic).value;
        if (!view) return;
        const decoded = decodeEvent(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        if (decoded) for (const listener of this.listeners) listener(decoded);
      });
      await events.value.startNotifications();
      this.subscribed = true;
    });
  }

  private async write(key: "setup" | "control" | "ota", bytes: Uint8Array): Promise<Result<void>> {
    const target = this.characteristic(key);
    if (!target.ok) return target;
    return attempt(() => target.value.writeValueWithResponse(bytes as unknown as BufferSource));
  }

  /**
   * Sends Wi-Fi, site and secret in one write; the device saves them and restarts onto the
   * network. Refused once the device is linked (`info().setupOpen`).
   */
  async provision(setup: Provisioning): Promise<Result<void>> {
    const bytes = encodeProvisioning(setup);
    if (!bytes.ok) return bytes;
    return this.write("setup", bytes.value);
  }

  async send(command: RemoteCommand): Promise<Result<void>> {
    const bytes = encodeCommand(command);
    if (!bytes.ok) return bytes;
    return this.write("control", bytes.value);
  }

  /**
   * Uploads a firmware image (an ESP-IDF `.bin`) into the device's other slot, frame by frame,
   * each with its CRC-32; the device checks the whole SHA-256, switches to it and restarts.
   */
  async updateFirmware(image: Uint8Array, options: UpdateOptions = {}): Promise<Result<{ version: string | null }>> {
    const subtle = (globalThis as { crypto?: { subtle?: { digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer> } } })
      .crypto?.subtle;
    if (!subtle) return fail("unsupported", "no Web Crypto to hash the image (needs a secure context)");
    const sha256 = new Uint8Array(await subtle.digest("SHA-256", image as unknown as BufferSource));
    const version = imageVersion(image);
    const begun = await this.write("ota", otaBegin(image.length, sha256, version ?? ""));
    if (!begun.ok) return begun;
    for (const { offset, frame } of otaChunks(image, options.chunk ?? OTA_CHUNK)) {
      if (options.signal?.aborted) {
        await this.write("ota", OTA_ABORT);
        return fail("cancelled", "update stopped");
      }
      const sent = await this.write("ota", frame);
      if (!sent.ok) return sent;
      options.onProgress?.(Math.min(offset + (frame.length - 9), image.length), image.length);
    }
    const ended = await this.write("ota", OTA_END);
    return ended.ok ? ok({ version }) : ended;
  }
}
