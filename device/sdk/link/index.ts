/**
 * @matecrew/device-link: set up, control, debug, update and watch the screen of a device over
 * Bluetooth LE from a web page, or control it through a server, with one API.
 * Framework-agnostic, no dependencies.
 */
export {
  PROTOCOL,
  UUIDS,
  ATTRIBUTE_MAX,
  OTA_CHUNK,
  OTA_END,
  OTA_ABORT,
  crc32,
  decodeEvent,
  decodeInfo,
  encodeCommand,
  encodeProvisioning,
  imageVersion,
  otaBegin,
  otaChunks,
  otaData,
  type DeviceEvent,
  type DeviceInfo,
  type LinkError,
  type LinkErrorCode,
  type Provisioning,
  type RemoteCommand,
  type Result,
  type Side,
} from "./protocol";
export {
  SCREEN_WHOLE,
  ScreenReader,
  TAP_COLUMNS,
  TAP_ROWS,
  encodeScreenTap,
  encodeScreenUpdate,
  screenNotifications,
  screenRgba,
  type Screen,
  type ScreenStep,
} from "./screen";
export { BleDevice, isSupported, type ConnectOptions, type UpdateOptions } from "./ble";
export { HttpRemote, commands, type DeviceRemote, type HttpRemoteOptions, type WatchOptions } from "./remote";
