/**
 * A device over Web Bluetooth (Chrome and Edge on Android, Windows, macOS, ChromeOS; not
 * Safari or Firefox). Writes that change something make the browser pair first: its system
 * dialog asks for the passkey the device shows on its screen. Watching the screen does too.
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
import type { DeviceRemote, WatchOptions } from "./remote";
import { SCREEN_WHOLE, ScreenReader, encodeScreenTap, type Screen } from "./screen";

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

/** `step` on each item, one after the other: browsers refuse a GATT operation while another is under way. */
function inSequence<T>(items: readonly T[], step: (item: T) => Promise<void>): Promise<void> {
  return items.reduce<Promise<void>>((previous, item) => previous.then(() => step(item)), Promise.resolve());
}

async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await run());
  } catch (error) {
    return { ok: false, error: linkError(error) };
  }
}

type Listener = (event: DeviceEvent) => void;
type ScreenListener = (screen: Screen) => void;

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
  private readonly screenListeners = new Map<ScreenListener, WatchOptions>();
  /** The screen mirror while someone watches: the last screen, its notification handler. */
  private mirror: { last: Screen | null; handler: (event: Event) => void } | null = null;

  private constructor(private readonly device: Device) {
    device.addEventListener("gattserverdisconnected", () => {
      this.chars = {};
      this.subscribed = false;
      this.mirror = null;
      for (const { onError } of this.screenListeners.values()) onError?.({ code: "disconnected", message: "the link dropped" });
      this.screenListeners.clear();
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

  /** The device mirrors its screen (`watchScreen`) and takes taps on it. */
  get hasScreen(): boolean {
    return this.chars.screen !== undefined;
  }

  /** Connects again after `disconnect`, or after the device restarted. */
  async connect(): Promise<Result<void>> {
    const gatt = this.device.gatt;
    if (!gatt) return fail("not-found", "the device has no GATT server");
    return attempt(async () => {
      const server = await gatt.connect();
      const service = await server.getPrimaryService(UUIDS.service);
      const keys = (Object.keys(UUIDS) as (keyof typeof UUIDS)[]).filter((key) => key !== "service");
      await inSequence(keys, async (key) => {
        // Devices without a screen have no screen mirror.
        const found = await service.getCharacteristic(UUIDS[key]).catch((error: unknown) => {
          if (key === "screen") return undefined;
          throw error;
        });
        if (found) this.chars[key] = found;
      });
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

  /**
   * The device's screen, live: the whole screen first, then each change (a few KB each, usually
   * within a second of the device drawing it). Pairs if needed. A lost notification is noticed
   * and the whole screen asked for again. Stops when the last listener does, or the link drops
   * (`onError` with `disconnected`). Returns a function that stops listening.
   */
  watchScreen(listener: ScreenListener, options: WatchOptions = {}): () => void {
    this.screenListeners.set(listener, options);
    if (this.mirror?.last) listener(this.mirror.last);
    else if (!this.mirror) void this.startMirror();
    return () => {
      if (this.screenListeners.delete(listener) && this.screenListeners.size === 0) void this.stopMirror();
    };
  }

  private async startMirror(): Promise<void> {
    const screen = this.chars.screen;
    const failed = (error: LinkError) => {
      for (const { onError } of this.screenListeners.values()) onError?.(error);
      this.screenListeners.clear();
      void this.stopMirror();
    };
    if (!screen) return failed({ code: "unsupported", message: "this device does not mirror its screen" });
    const reader = new ScreenReader();
    const mirror = {
      last: null as Screen | null,
      handler: (event: Event) => {
        const view = (event.target as unknown as Characteristic).value;
        if (!view || this.mirror !== mirror) return;
        const step = reader.push(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        if (step.resync) void this.askWhole(mirror);
        if (!step.screen) return;
        mirror.last = step.screen;
        for (const listener of this.screenListeners.keys()) listener(step.screen);
      },
    };
    this.mirror = mirror;
    screen.addEventListener("characteristicvaluechanged", mirror.handler);
    // Subscribing starts the mirror; the write pairs if needed, and asks for the whole screen.
    const subscribed = await attempt(() => screen.startNotifications());
    const started = subscribed.ok ? await this.write("screen", SCREEN_WHOLE) : subscribed;
    if (!started.ok && this.mirror === mirror) failed(started.error);
  }

  /** Asks for the whole screen, a few times if the write fails: the reader waits for it meanwhile. */
  private async askWhole(mirror: object, tries = 3): Promise<void> {
    if (tries === 0 || this.mirror !== mirror) return;
    if ((await this.write("screen", SCREEN_WHOLE)).ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await this.askWhole(mirror, tries - 1);
  }

  private async stopMirror(): Promise<void> {
    const mirror = this.mirror;
    const screen = this.chars.screen;
    this.mirror = null;
    if (!mirror || !screen) return;
    screen.removeEventListener("characteristicvaluechanged", mirror.handler);
    await screen.stopNotifications().catch(() => undefined);
  }

  /** One write at a time: browsers refuse a GATT operation while another is under way. */
  private writes: Promise<unknown> = Promise.resolve();

  private async write(key: "setup" | "control" | "ota" | "screen", bytes: Uint8Array): Promise<Result<void>> {
    const target = this.characteristic(key);
    if (!target.ok) return target;
    const done = this.writes.then(() => attempt(() => target.value.writeValueWithResponse(bytes as unknown as BufferSource)));
    this.writes = done;
    return done;
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

  /** A tap goes to the screen it touches (`hasScreen`), every other command to `CONTROL`. */
  async send(command: RemoteCommand): Promise<Result<void>> {
    if (command.cmd === "tap") {
      if (this.connected && !this.hasScreen) return fail("unsupported", "this device takes no taps");
      const bytes = encodeScreenTap(command.x, command.y);
      return bytes.ok ? this.write("screen", bytes.value) : bytes;
    }
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
