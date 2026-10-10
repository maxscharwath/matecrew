/** Where entries live. The cache only needs named strings, read and written whole. */
export interface Backend {
  /** The entry stored under `name`, or undefined. */
  read(name: string): string | undefined;
  /** Stores `entry` under `name`, replacing what was there; throws when full or refused. */
  write(name: string, entry: string): void;
  /** Removes `name`; nothing to remove is fine. */
  remove(name: string): void;
  /** Every name stored, for `usage` and `clear`. */
  names(): string[];
  /** The room the medium has in all, in bytes, when it knows. */
  capacity?(): number | undefined;
}

/** Entries in a `Map`: tests and servers; nothing lasts. */
export function memoryBackend(entries = new Map<string, string>()): Backend & { entries: Map<string, string> } {
  return {
    entries,
    read: (name) => entries.get(name),
    write: (name, entry) => {
      entries.set(name, entry);
    },
    remove: (name) => {
      entries.delete(name);
    },
    names: () => [...entries.keys()],
  };
}

export type LocalStorageOptions = {
  /** Put before every name, so several caches share one origin: `"matecrew:"`. */
  prefix?: string;
  /** `localStorage` by default; `sessionStorage` or a stand-in for tests. */
  storage?: Storage;
};

/**
 * Entries in `localStorage` under `prefix`. Where storage is blocked (private windows, some
 * embedded views) or absent (server rendering), reads find nothing and writes fail: the cache
 * reports it and the page keeps working.
 */
export function localStorageBackend({ prefix = "cache:", storage }: LocalStorageOptions = {}): Backend {
  const store = (): Storage => {
    const found = storage ?? globalThis.localStorage;
    if (!found) throw new Error("no localStorage here");
    return found;
  };
  const quietly = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };
  return {
    read: (name) => quietly(() => store().getItem(prefix + name) ?? undefined, undefined),
    write: (name, entry) => store().setItem(prefix + name, entry),
    remove: (name) => quietly(() => store().removeItem(prefix + name), undefined),
    names: () =>
      quietly(() => {
        const found = store();
        const names: string[] = [];
        for (let i = 0; i < found.length; i++) {
          const name = found.key(i);
          if (name?.startsWith(prefix)) names.push(name.slice(prefix.length));
        }
        return names;
      }, []),
  };
}
