# @matecrew/device-cache

What a page keeps that it could fetch again, declared as typed keys that say **what**, **for how
long** and **how big**, and checked when read back. The TypeScript twin of the terminal
firmware's `matecrew-cache` crate (`device/cache`): same keys, same rules. Plain TypeScript, no
framework, no dependencies.

In this repository it is also exported as `@matecrew/device-ui/cache`.

## Quick start

```ts
import { Cache, DAY, Keep, key, localStorageBackend } from "@matecrew/device-cache";

const STATE = key<DeviceState>("state").keep(Keep.forever).maxBytes(96 * 1024);
const APP = key<Uint8Array>("app").keep(Keep.for(DAY)).maxBytes(32 * 1024);

const cache = Cache.open(localStorageBackend({ prefix: "matecrew:" })); // or memoryBackend()
cache.put(STATE, state);                                 // { ok: true } or { ok: false, error }
const last = cache.get(STATE);                           // undefined: missing, expired or corrupt
const app = await cache.remember(APP, () => download()); // get, or compute and keep
cache.forget(APP);
console.table(cache.usage().entries);                    // every entry: bytes, written, expires
```

Values are JSON, or bytes for a `Uint8Array` (stored as base64). Reads never throw; `put`
returns a result (`too-large`, `encode`, `backend`) and never throws either.
`Cache.open(backend, { clock, onError })`: `onError` hears entries dropped on read and
values `remember` could not keep.

## Rules

- **Cache only what the server sends again.** A token or a queue the server has not acknowledged
  is not a cache.
- **Declare every key in one place**, as constants, with its `keep` and `maxBytes`. A key that
  says nothing keeps 4 KB for a day: a big or long-lived entry is a choice someone wrote down.
  Names of 15 bytes or less stay valid on the firmware too.
- **Keep for as long as the value is useful offline, no longer.** `Keep.forever` only for what
  the page needs without network; the shorter of the key's and the entry's keep applies.
- **Limits apply on `put`.** Over `maxBytes`, the value is refused and the old one stays. The
  sum of the limits is the most the cache can take.
- **Reads check everything.** An entry is a JSON header line (format, the key's `version`,
  written-at, keep, type, CRC-32) then the value. A missing, expired or damaged entry, or one in
  another format or version, reads as `undefined` and is removed. Bump `key(...).version(n)` when a
  type changes shape.
- **The clock may not be set** (a device that just started; tests). Before 2024-01-01 it counts
  as unset, and while it is, nothing expires. An entry written without a clock starts its keep
  at the first read with one; a clock that went back makes entries younger, never older.
- **The same value is not written again**, unless half its keep has passed (to date it again).
- `usage()` lists every entry with its size and expiry; `clear()` empties the cache.

## Backends

| | |
|---|---|
| `memoryBackend()` | A `Map`: tests, servers, nothing lasts. |
| `localStorageBackend({ prefix?, storage? })` | `localStorage` (or any `Storage`) under `prefix`. Blocked or absent storage reads as empty and refuses writes. |

A `Backend` is `read`, `write`, `remove`, `names` and an optional `capacity` over strings; write
your own for another store.

## Test

```sh
bun test device/sdk/cache
```
