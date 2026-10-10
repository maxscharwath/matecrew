# @matecrew/device-link

Set up, control, debug and update a device over **Bluetooth LE** from a web page, or control it
**through a server**, with one typed API. Plain TypeScript, no framework, no dependencies.

The device side is the matecrew badge terminal's firmware (`device/firmware/src/ble.rs`, messages
in `device/core/src/link.rs`), but nothing in the protocol is specific to it: a site address and
a link secret are opaque strings, a badge is a hex UID.

## Install

```sh
npm install @matecrew/device-link   # or bun add / pnpm add
```

In this repository it is also exported as `@matecrew/device-ui/link`.

## Browser support

Web Bluetooth: Chrome and Edge on Android, Windows, macOS, ChromeOS, in a secure context (HTTPS
or localhost), from a user gesture. Not Safari (iPhone, iPad, Mac) nor Firefox: use the device's
other setup path there. `isSupported()` tells.

## Use

```ts
import { BleDevice, HttpRemote, commands, isSupported } from "@matecrew/device-link";

if (await isSupported()) {
  // In a click handler: the browser shows its device chooser.
  const picked = await BleDevice.request();
  if (!picked.ok) return console.warn(picked.error.code, picked.error.message);
  const device = picked.value;

  const info = await device.info(); // { name, hardwareId, firmware, linked, setupOpen, networks, … }

  // Changes need pairing: the browser's dialog asks for the passkey the device shows.
  const stop = device.onEvent((event) => {
    if (event.t === "log") console.log(event.level, event.target, event.msg);
  });
  await device.provision({ ssid: "Office", password: wifiPassword, site: location.origin, secret });
  await commands.press(device, "left");
  await device.updateFirmware(new Uint8Array(await file.arrayBuffer()), {
    onProgress: (done, total) => console.log(Math.round((done * 100) / total), "%"),
  });
  stop();
  device.disconnect();
}

// The same commands through a server that relays them:
const remote = new HttpRemote({ baseUrl: "/api/device-remote/abc123", credentials: "same-origin" });
await commands.sync(remote);
```

Every call returns a `Result`: `{ ok: true, value }` or `{ ok: false, error: { code, message } }`,
never throws. Codes: `unsupported`, `cancelled`, `not-found`, `disconnected`, `protocol`,
`invalid`, `refused`, `timeout`, `transport`.

### API

| | |
|---|---|
| `isSupported()` | Web Bluetooth is available here. |
| `BleDevice.request({ namePrefix? })` | Chooser filtered on the service, then connect. |
| `device.connect()` / `disconnect()` / `onDisconnect(fn)` | Link state. |
| `device.info()` | `DeviceInfo`; fails with `protocol` if the device is newer. |
| `device.provision({ ssid, password?, site?, secret? })` | One write; the device saves and restarts. Refused once linked. |
| `device.send(command)` and `commands.*` | `key`, `both`, `badge`, `sync`, `restart`, `notify`. |
| `device.onEvent(fn)` | `log`, `done` (answer to a setup/control write), `ota` progress. |
| `device.updateFirmware(image, { onProgress, chunk, signal })` | ESP-IDF `.bin` into the other slot. |
| `new HttpRemote({ baseUrl, headers?, credentials?, fetch? })` | `GET {baseUrl}/info`, `POST {baseUrl}/commands`. |

`DeviceRemote` is the interface both transports implement (`transport`, `info`, `send`,
`onEvent?`); write your own for another one.

## Protocol 1

One GATT service, `d3b70000-6b0e-4e4f-8c1a-5f3a2b1c0d00`; characteristics share its base,
`d3b7000N-…`. JSON is UTF-8; integers in binary frames are little-endian. A value is at most 512
bytes (one attribute).

| Characteristic | UUID suffix | Access | Content |
|---|---|---|---|
| Info | `0001` | read | JSON `DeviceInfo`, including `protocol` |
| Setup | `0002` | write, authenticated | JSON `{ ssid, password?, site?, secret? }`; accepted while not linked |
| Control | `0003` | write, authenticated | JSON `{ cmd: "key", side }`, `{ cmd: "both" }`, `{ cmd: "badge", uid }`, `{ cmd: "sync" }`, `{ cmd: "restart" }`, `{ cmd: "notify", text }` |
| Events | `0004` | notify (to authenticated links) | JSON `{ t: "log", level, target, msg }`, `{ t: "done", op, ok, error }`, `{ t: "ota", state, done, total, error }` |
| OTA | `0005` | write, authenticated | `0x01` size u32, SHA-256 (32 B), version · `0x02` offset u32, CRC-32 u32, data · `0x03` end · `0x04` abort |

**Security.** Authenticated means LE Secure Connections with passkey entry (MITM-protected):
the device shows a 6-digit passkey, new at each boot, on its screen; the browser's pairing dialog
asks for it. Nothing is bonded. A refused write answers ATT error `0x80`; the reason follows as
a `done` event.

**Firmware update.** Frames must come in order (`offset` = bytes acknowledged so far), each with
the CRC-32 (IEEE, as zlib) of its data. The device writes as frames arrive, checks the size and
the SHA-256 at `0x03`, lets ESP-IDF check the image, makes it boot next and restarts. It stays
pending until it confirms itself; the bootloader rolls back otherwise.

**Versions.** `Info.protocol` is the device's version; this module reads devices up to
`PROTOCOL` and reports `protocol` for newer ones. Unknown event types are ignored.

## Test

```sh
bun test device/sdk/link
```
