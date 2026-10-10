# matecrew-cache

What a device keeps between restarts that it could fetch again, declared as typed keys that say
**what**, **for how long** and **how big**, and checked when read back. Storage is a small trait:
the terminal's firmware puts entries in NVS (`device/firmware/src/cache.rs`), tests and wasm in
memory. Host-testable: `cargo test`. Its TypeScript twin is `@matecrew/device-cache`
(`device/sdk/cache`).

## Quick start

```rust
use matecrew_cache::{Cache, Keep, Key, MemoryBackend, Raw, DAY};

pub const STATE: Key<DeviceState> = Key::new("state").keep(Keep::Forever).max_bytes(96 * 1024);
pub const APP: Key<Vec<u8>, Raw> = Key::new("app").keep(Keep::For(DAY)).max_bytes(32 * 1024);

let cache = Cache::open(MemoryBackend::new()); // the firmware: an NVS backend
cache.put(&STATE, &state)?;
let state: Option<DeviceState> = cache.get(&STATE)?; // None: missing, expired or corrupt
let app = cache.remember(&APP, || api.app_bytecode(&url))?; // get, or compute and keep
cache.forget(&APP)?;
log::info!("cache: {}", cache.usage()); // every entry: size and time left
```

Values go through serde as JSON (`Key<T>`), or as raw bytes (`Key<Vec<u8>, Raw>`) for bytecode
and images, which JSON would triple. Implement `Codec<T>` for another format.

## Rules

- **Cache only what the server sends again.** Settings (Wi-Fi, site, token) and what the server
  has not acknowledged yet (the queue of takes) are not a cache: keep them in plain storage.
- **Declare every key in one place**, as constants, with its `keep` and `max_bytes`. A key that
  says nothing keeps 4 KB for a day (`DEFAULT_MAX_BYTES`, `DEFAULT_KEEP`): a big or long-lived
  entry is a choice someone wrote down. Names are 1 to 15 bytes (NVS's limit), checked at build.
- **Keep for as long as the value is useful offline, no longer.** `Keep::Forever` only for what
  the device needs to work without network (the last state). Something downloaded at every sync
  needs only enough to start without network: days, not months. The shorter of the key's and the
  entry's keep applies, so shortening a key shortens what is already kept.
- **Limits apply on `put`.** A value over `max_bytes` is refused (`Error::TooLarge`) and the old
  one stays. The sum of the limits is the most the cache can take: keep it within the partition.
- **Reads never trust the flash.** Each entry has a 20-byte header: format, the key's
  `version`, written-at, keep, length and a CRC-32. A missing, expired or damaged entry, one in
  another format or version, or one whose type changed (bump `Key::version`), reads as `None`
  and is removed; `on_error` hears about the damaged ones.
- **The clock may not be set** (the terminal gets it over NTP or from the site). Before
  2024-01-01 (`CLOCK_SET_AFTER`) the clock counts as unset, and while it is, nothing expires. An
  entry written without a clock starts its keep at the first read with one; a clock that went
  back makes entries younger, never older.
- **The same value is not written again** (the terminal syncs every two minutes): only when it
  changes, or once half its keep has passed, to date it again.
- `usage()` lists every entry with its size and expiry; `clear()` empties the cache.

## What the terminal caches

Declared in `device/firmware/src/cache.rs`, kept in the 256 KB `cache` NVS partition
(`partitions.csv`, required: every USB flash writes it). Unlinking the terminal clears it. The
limits add up to 145 KB; NVS also needs room for a new copy of the largest entry while it
replaces it.

| Key | Keep | Limit | Typical | What |
|---|---|---|---|---|
| `state` | for ever | 96 KB | 20 to 60 KB | badges, keys, items and their 96 x 96 pictures (3 KB an item, twice) |
| `app` | 7 days | 32 KB | 1 to 7 KB | the office's SDK app (DUI bytecode, `dist/*.dui` sizes), raw |
| `app_url` | 7 days | 512 B | 60 B | where `app` came from |
| `app_data` | 7 days | 8 KB | a few KB | that app's local state and fetched data |
| `showcase` | 1 day | 8 KB | a few KB | the showcase's navigation, theme and images |

The about page's storage gauge counts the settings partition and the cache's `usage()`.
