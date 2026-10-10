/**
 * @matecrew/device-cache: what a page or a device keeps that it could fetch again, declared as
 * typed keys that say how long and how big, checked when read back. The TypeScript twin of the
 * firmware's `matecrew-cache` crate (`device/cache`). No dependencies.
 */
export {
  CLOCK_SET_AFTER,
  Cache,
  type CacheError,
  type CacheErrorCode,
  type CacheOptions,
  type Expires,
  type Result,
  type Usage,
  type UsageEntry,
} from "./cache";
export { DAY, DEFAULT_KEEP, DEFAULT_MAX_BYTES, HOUR, Keep, Key, MINUTE, WEEK, key } from "./key";
export { localStorageBackend, memoryBackend, type Backend, type LocalStorageOptions } from "./backends";
