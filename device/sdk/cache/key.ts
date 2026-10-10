/** Typed keys: what is cached, for how long and how big, said once where the key is declared. */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

/** How long an entry is good for, from when it was written; past that it reads as missing. */
export type Keep = { readonly forever: true } | { readonly ms: number };

export const Keep = {
  /** Until it is replaced or forgotten: for what the page needs to work offline. */
  forever: { forever: true } as Keep,
  /** For this long after it was written, in milliseconds (`Keep.for(DAY)`). */
  for: (ms: number): Keep => ({ ms: Math.max(0, ms) }),
};

/** What a key keeps when it does not say: small values, so a big one is a choice someone wrote. */
export const DEFAULT_MAX_BYTES = 4 * 1024;
export const DEFAULT_KEEP: Keep = Keep.for(DAY);

/**
 * A cached value's name, type, lifetime and size limit. Declare keys as constants, together, so
 * one place says everything a page caches:
 *
 * ```ts
 * const STATE = key<DeviceState>("state").keep(Keep.forever).maxBytes(96 * 1024);
 * const APP = key<Uint8Array>("app").keep(Keep.for(DAY)).maxBytes(32 * 1024);
 * ```
 *
 * Values are JSON, or bytes for a `Uint8Array` (kept as base64, not as a JSON array).
 */
export class Key<T> {
  /** Only for the type: a `Key<string>` is not a `Key<number>`. */
  declare protected readonly value: T;

  private constructor(
    readonly name: string,
    readonly kept: Keep,
    readonly limit: number,
    readonly shape: number,
  ) {}

  /** A key that keeps its value `DEFAULT_KEEP` and at most `DEFAULT_MAX_BYTES`. */
  static named<T>(name: string): Key<T> {
    if (!name) throw new TypeError("a cache key needs a name");
    return new Key<T>(name, DEFAULT_KEEP, DEFAULT_MAX_BYTES, 1);
  }

  keep(keep: Keep): Key<T> {
    return new Key<T>(this.name, keep, this.limit, this.shape);
  }

  /** The most the value may take, encoded (UTF-8 JSON, or the bytes); a bigger one is refused. */
  maxBytes(bytes: number): Key<T> {
    return new Key<T>(this.name, this.kept, bytes, this.shape);
  }

  /**
   * The value's shape: bump it when the type changes in a way that would still parse wrongly.
   * Entries written with another version read as missing.
   */
  version(version: number): Key<T> {
    return new Key<T>(this.name, this.kept, this.limit, version);
  }
}

/** `key<DeviceState>("state")`: see {@link Key}. */
export const key = <T>(name: string): Key<T> => Key.named<T>(name);
