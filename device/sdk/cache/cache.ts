import type { Backend } from "./backends";
import { type Header, fromBase64, open, seal, toBase64, utf8Length } from "./entry";
import type { Key } from "./key";

/** 2024-01-01 in Unix milliseconds: a clock before it has not been set. */
export const CLOCK_SET_AFTER = 1_704_067_200_000;

export type CacheErrorCode =
  /** The value is bigger than its key's `maxBytes`: not kept, and the old one stays. */
  | "too-large"
  /** The value is not JSON (a function, a cycle, `undefined`). */
  | "encode"
  /** The storage refused (quota, blocked). */
  | "backend"
  /** An entry that did not read back (another format or version, bad checksum): removed. */
  | "dropped";

export type CacheError = { code: CacheErrorCode; key: string; message: string };
export type Result = { ok: true } | { ok: false; error: CacheError };

export type CacheOptions = {
  /** Unix milliseconds, undefined when unknown; `Date.now` by default. */
  clock?: () => number | undefined;
  /** Hears what a read cannot return: entries dropped, storage failures. */
  onError?: (error: CacheError) => void;
};

export type Expires = "never" | { at: number } | { pending: number };

export type UsageEntry = {
  key: string;
  /** UTF-8 bytes, header included. */
  bytes: number;
  /** Unix milliseconds; undefined when written before the clock was set. */
  written?: number;
  /** `pending`: written before the clock was set, it keeps that long from the first read with one. */
  expires: Expires;
};

export type Usage = {
  used: number;
  /** The backend's capacity, when it knows. */
  total?: number;
  /** Largest first. */
  entries: UsageEntry[];
  /** The clock when this was taken: what `expires` is counted from. */
  now?: number;
};

type Loaded = { header: Header; payload: string; bytes: number };

/**
 * Typed entries over a {@link Backend}. Reads never throw: missing, expired, corrupt and
 * other-format entries all read as `undefined` (and are removed). `put` says whether it kept the
 * value. See the README for the rules, the clock's above all.
 */
export class Cache {
  private constructor(
    private readonly backend: Backend,
    private readonly options: CacheOptions,
  ) {}

  static open(backend: Backend, options: CacheOptions = {}): Cache {
    return new Cache(backend, options);
  }

  /** The value, or undefined when it is missing, expired, corrupt or from another format. */
  get<T>(key: Key<T>): T | undefined {
    const entry = this.load(key.name, key.shape, keepOf(key));
    if (!entry) return undefined;
    try {
      return (entry.header.type === "bytes" ? fromBase64(entry.payload) : JSON.parse(entry.payload)) as T;
    } catch {
      this.drop(key.name, "value does not decode");
      return undefined;
    }
  }

  /**
   * Keeps the value under its key, replacing what was there. The same value again is not
   * written, unless half its keep has passed: it is then dated again, so a value that is still
   * current does not expire.
   */
  put<T>(key: Key<T>, value: NoInfer<T>): Result {
    const name = key.name;
    const bytes = value instanceof Uint8Array ? value : undefined;
    let payload: string | undefined;
    try {
      payload = bytes ? toBase64(bytes) : JSON.stringify(value);
    } catch (error) {
      return fail("encode", name, String(error));
    }
    if (payload === undefined) return fail("encode", name, "not a JSON value");
    const size = bytes ? bytes.length : utf8Length(payload);
    if (size > key.limit) return fail("too-large", name, `${size} bytes, over its ${key.limit}`);
    const fields = { version: key.shape, written: this.now() ?? null, keep: keepOf(key), type: bytes ? "bytes" : "json" } as const;
    const kept = this.peek(name);
    if (kept?.payload === payload && !redate(kept.header, fields)) return { ok: true };
    try {
      this.backend.write(name, seal(fields, payload));
    } catch (error) {
      return fail("backend", name, String(error));
    }
    return { ok: true };
  }

  /**
   * The value if it is there, or else what `compute` gives, kept for next time. Only `compute`'s
   * error comes back: the cache failing to keep the value goes to `onError`.
   */
  async remember<T>(key: Key<T>, compute: () => T | Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await compute();
    const kept = this.put(key, value);
    if (!kept.ok) this.options.onError?.(kept.error);
    return value;
  }

  forget(key: Key<unknown>): void {
    this.backend.remove(key.name);
  }

  /** Removes every entry. */
  clear(): void {
    for (const name of this.backend.names()) this.backend.remove(name);
  }

  /** Every entry with its size and expiry, dropping what expired or broke on the way. */
  usage(): Usage {
    const entries: UsageEntry[] = [];
    for (const name of this.backend.names()) {
      const entry = this.load(name, undefined, null);
      if (entry) entries.push({ key: name, bytes: entry.bytes, written: entry.header.written ?? undefined, expires: expiry(entry.header) });
    }
    entries.sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));
    return {
      used: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      total: this.backend.capacity?.(),
      entries,
      now: this.now(),
    };
  }

  /** The clock, undefined while it is not set. */
  private now(): number | undefined {
    const now = (this.options.clock ?? Date.now)();
    return now !== undefined && now >= CLOCK_SET_AFTER ? now : undefined;
  }

  /** A whole entry without the expiry rules: for telling an unchanged value. */
  private peek(name: string): Loaded | undefined {
    const raw = this.backend.read(name);
    if (raw === undefined) return undefined;
    const opened = open(raw);
    return "error" in opened ? undefined : { ...opened, bytes: utf8Length(raw) };
  }

  /**
   * A whole, current entry, or undefined after dropping it. `version` and `keep` are the key's
   * when a key asks; `usage` only knows the header.
   */
  private load(name: string, version: number | undefined, keep: number | null): Loaded | undefined {
    const raw = this.backend.read(name);
    if (raw === undefined) return undefined;
    const opened = open(raw);
    if ("error" in opened) {
      this.drop(name, opened.error);
      return undefined;
    }
    const { header, payload } = opened;
    if (version !== undefined && header.version !== version) {
      this.drop(name, "another version");
      return undefined;
    }
    const keeps = shorter(keep, header.keep);
    const now = this.now();
    if (now === undefined || keeps === null) return { header, payload, bytes: utf8Length(raw) };
    if (header.written === null) return this.date(name, { ...header, written: now }, payload);
    if (now < header.written + keeps) return { header, payload, bytes: utf8Length(raw) };
    this.backend.remove(name);
    return undefined;
  }

  /** Writes an entry from before the clock was set again, dated: its keep starts now. */
  private date(name: string, header: Header, payload: string): Loaded {
    const entry = seal(header, payload);
    try {
      this.backend.write(name, entry);
    } catch (error) {
      this.options.onError?.({ code: "backend", key: name, message: String(error) });
    }
    return { header, payload, bytes: utf8Length(entry) };
  }

  /** Removes an entry that did not read back, and says so. */
  private drop(name: string, why: string): void {
    this.backend.remove(name);
    this.options.onError?.({ code: "dropped", key: name, message: why });
  }
}

const fail = (code: CacheErrorCode, key: string, message: string): Result => ({
  ok: false,
  error: { code, key, message: `${key}: ${message}` },
});

const keepOf = (key: Key<unknown>): number | null => ("forever" in key.kept ? null : key.kept.ms);

/** The shorter of two keeps, null being for ever. */
function shorter(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function expiry({ written, keep }: Header): Expires {
  if (keep === null) return "never";
  if (written === null) return { pending: keep };
  return { at: written + keep };
}

/**
 * Whether an entry holding the same value as a new one is written anyway: another version or
 * keep, no date while the clock now has one, or half its keep gone.
 */
function redate(kept: Header, next: Pick<Header, "version" | "keep" | "written">): boolean {
  if (kept.version !== next.version || kept.keep !== next.keep) return true;
  if (kept.keep === null || next.written === null) return false;
  if (kept.written === null) return true;
  return next.written >= kept.written + kept.keep / 2;
}
