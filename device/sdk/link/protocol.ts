/**
 * The device link protocol, as bytes: UUIDs, version, the JSON written to set up or control a
 * device, the events it notifies, the frames of a firmware update and their CRC-32 (the screen
 * mirror is in `screen.ts`). Pure: no Bluetooth, no DOM. Mirrors `device/core/src/link.rs` on the
 * firmware side.
 */

/** Bumped when a message changes in a way an older peer would misread. */
export const PROTOCOL = 1;

export const UUIDS = {
  service: "d3b70000-6b0e-4e4f-8c1a-5f3a2b1c0d00",
  info: "d3b70001-6b0e-4e4f-8c1a-5f3a2b1c0d00",
  setup: "d3b70002-6b0e-4e4f-8c1a-5f3a2b1c0d00",
  control: "d3b70003-6b0e-4e4f-8c1a-5f3a2b1c0d00",
  events: "d3b70004-6b0e-4e4f-8c1a-5f3a2b1c0d00",
  ota: "d3b70005-6b0e-4e4f-8c1a-5f3a2b1c0d00",
  /** Optional: devices without a screen, or older ones, do not have it. */
  screen: "d3b70006-6b0e-4e4f-8c1a-5f3a2b1c0d00",
} as const;

/** The longest attribute value (Bluetooth Core, ATT): one write at most. */
export const ATTRIBUTE_MAX = 512;
/** Firmware bytes per `OTA` data frame: the frame (9 bytes of header) stays within one attribute. */
export const OTA_CHUNK = 496;

export type DeviceInfo = {
  protocol: number;
  name: string;
  /** Wi-Fi MAC, "AC:A7:04:2B:50:E4". */
  hardwareId: string;
  firmware: { version: string; build: string; commit: string; slot: string | null };
  linked: boolean;
  /** `provision` is accepted. */
  setupOpen: boolean;
  site: string | null;
  uptime: number;
  heap: number;
  wifi: { ssid: string; rssi: number | null } | null;
  /** Networks the device heard, strongest first. */
  networks: string[];
};

export type Provisioning = {
  ssid: string;
  password?: string;
  /** Where the device should talk to, e.g. the page's origin. Opaque to the protocol. */
  site?: string;
  /** A secret the site gave for this device (a pre-approved link). Opaque to the protocol. */
  secret?: string;
};

export type Side = "left" | "right";

/** What a device can be asked to do, over Bluetooth or another transport. */
export type RemoteCommand =
  | { cmd: "key"; side: Side }
  | { cmd: "both" }
  | { cmd: "badge"; uid: string }
  | { cmd: "sync" }
  | { cmd: "restart" }
  | { cmd: "notify"; text: string }
  /** A touch on the screen at (x, y) of a 200 × 120 grid, whatever the screen's size. */
  | { cmd: "tap"; x: number; y: number };

export type DeviceEvent =
  | { t: "log"; level: "E" | "W" | "I" | "D" | "V"; target: string; msg: string }
  | { t: "done"; op: "setup" | "control"; ok: boolean; error: string | null }
  | { t: "ota"; state: "ready" | "writing" | "done" | "failed"; done: number; total: number; error: string | null };

export type LinkErrorCode =
  /** No Web Bluetooth here (Safari, Firefox, no secure context). */
  | "unsupported"
  /** The person closed the device chooser, or the pairing dialog. */
  | "cancelled"
  /** No device, or it went away. */
  | "not-found"
  | "disconnected"
  /** The device speaks a newer protocol than this module. */
  | "protocol"
  /** A value the device or this module refuses (with a reason). */
  | "invalid"
  /** The device refused the operation (not allowed now, failed check). */
  | "refused"
  | "timeout"
  /** Anything else on the way: Bluetooth stack, network. */
  | "transport";

export type LinkError = { code: LinkErrorCode; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: LinkError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (code: LinkErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } });

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Checks a provisioning as the device will (Wi-Fi limits, lengths) and encodes it. */
export function encodeProvisioning(setup: Provisioning): Result<Uint8Array> {
  const password = setup.password ?? "";
  const ssidBytes = encoder.encode(setup.ssid).length;
  if (ssidBytes === 0 || ssidBytes > 32) return fail("invalid", "the network name must be 1 to 32 bytes");
  if (password.length > 64 || (password.length > 0 && password.length < 8)) {
    return fail("invalid", "a Wi-Fi password has 8 to 64 characters, or none");
  }
  if (setup.site !== undefined && (setup.site.length === 0 || setup.site.length > 128)) {
    return fail("invalid", "the site address must be 1 to 128 characters");
  }
  if (setup.secret !== undefined && (setup.secret.length === 0 || setup.secret.length > 128)) {
    return fail("invalid", "the secret must be 1 to 128 characters");
  }
  const bytes = encoder.encode(JSON.stringify({ ssid: setup.ssid, password, site: setup.site, secret: setup.secret }));
  return bytes.length <= ATTRIBUTE_MAX ? ok(bytes) : fail("invalid", "provisioning longer than one attribute");
}

/** An integer cell of a grid `size` wide. */
const isCell = (value: number, size: number) => Number.isInteger(value) && value >= 0 && value < size;

export function encodeCommand(command: RemoteCommand): Result<Uint8Array> {
  if (command.cmd === "notify" && (command.text.length === 0 || command.text.length > 256)) {
    return fail("invalid", "a notification has 1 to 256 characters");
  }
  if (command.cmd === "badge" && !/^[0-9A-Fa-f:\s-]{8,40}$/.test(command.uid)) {
    return fail("invalid", "a badge UID is hexadecimal");
  }
  if (command.cmd === "tap" && !(isCell(command.x, 200) && isCell(command.y, 120))) {
    return fail("invalid", "a tap is within 200 × 120");
  }
  return ok(encoder.encode(JSON.stringify(command)));
}

export function decodeInfo(bytes: Uint8Array): Result<DeviceInfo> {
  let info: DeviceInfo;
  try {
    info = JSON.parse(decoder.decode(bytes)) as DeviceInfo;
  } catch {
    return fail("transport", "the device sent unreadable info");
  }
  if (typeof info.protocol !== "number") return fail("transport", "the device sent no protocol version");
  if (info.protocol > PROTOCOL) {
    return fail("protocol", `the device speaks protocol ${info.protocol}; this module knows up to ${PROTOCOL}`);
  }
  return ok(info);
}

/** An event notification, or null for anything this module does not know (newer devices). */
export function decodeEvent(bytes: Uint8Array): DeviceEvent | null {
  try {
    const event = JSON.parse(decoder.decode(bytes)) as { t?: unknown };
    return event.t === "log" || event.t === "done" || event.t === "ota" ? (event as DeviceEvent) : null;
  } catch {
    return null;
  }
}

/** `0x01`, size (u32 LE), SHA-256 of the whole image, the version (UTF-8). */
export function otaBegin(size: number, sha256: Uint8Array, version = ""): Uint8Array {
  if (sha256.length !== 32) throw new Error("SHA-256 is 32 bytes");
  const name = encoder.encode(version).slice(0, ATTRIBUTE_MAX - 37);
  const frame = new Uint8Array(37 + name.length);
  frame[0] = 0x01;
  new DataView(frame.buffer).setUint32(1, size, true);
  frame.set(sha256, 5);
  frame.set(name, 37);
  return frame;
}

/** `0x02`, offset (u32 LE), CRC-32 of the data (u32 LE), the data. */
export function otaData(offset: number, bytes: Uint8Array): Uint8Array {
  const frame = new Uint8Array(9 + bytes.length);
  const view = new DataView(frame.buffer);
  frame[0] = 0x02;
  view.setUint32(1, offset, true);
  view.setUint32(5, crc32(bytes), true);
  frame.set(bytes, 9);
  return frame;
}

export const OTA_END = Uint8Array.of(0x03);
export const OTA_ABORT = Uint8Array.of(0x04);

/** The image cut into data frames, in order. */
export function* otaChunks(image: Uint8Array, chunk = OTA_CHUNK): Generator<{ offset: number; frame: Uint8Array }> {
  if (chunk <= 0 || chunk + 9 > ATTRIBUTE_MAX) throw new Error(`a chunk is 1 to ${ATTRIBUTE_MAX - 9} bytes`);
  for (let offset = 0; offset < image.length; offset += chunk) {
    yield { offset, frame: otaData(offset, image.subarray(offset, offset + chunk)) };
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, as zlib), the same as the firmware's. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * The version an ESP-IDF application image declares (`esp_app_desc_t`, right after the image
 * and first segment headers), or null if `image` is not one.
 */
export function imageVersion(image: Uint8Array): string | null {
  const DESC = 24 + 8;
  if (image.length < DESC + 48 || image[0] !== 0xe9) return null;
  const magic = new DataView(image.buffer, image.byteOffset).getUint32(DESC, true);
  if (magic !== 0xabcd5432) return null;
  const field = image.subarray(DESC + 16, DESC + 48);
  const end = field.indexOf(0);
  return decoder.decode(end < 0 ? field : field.subarray(0, end)) || null;
}
