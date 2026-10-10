//! Everything the terminal caches, in one place: the site sends all of it again at the next sync,
//! so each key says how long it is worth keeping and how much flash it may take
//! (`matecrew-cache`, `device/cache`). Settings (Wi-Fi, site, token, queue of takes) are not a
//! cache: they stay in `store.rs`.

use anyhow::Result;
use esp_idf_svc::{
    nvs::{EspCustomNvsPartition, EspNvs, NvsCustom, NvsDataType},
    sys::{nvs_get_stats, nvs_stats_t, ESP_OK},
};
use matecrew_cache::{Backend, Error, Keep, Key, Raw, Usage, DAY, WEEK};
use matecrew_core::contract::DeviceState;
use std::sync::{Mutex, MutexGuard, OnceLock};

/// Badges, keys and items with their pictures, from the last sync: for badging offline and the
/// first screen after a restart. 20 to 60 KB, nearly all pictures (3 KB an item, twice).
pub const STATE: Key<DeviceState> = Key::new("state").keep(Keep::Forever).max_bytes(96 * 1024);
/// The office's SDK app (DUI bytecode, 1 to 7 KB) and the address it came from. Downloaded again
/// at every sync: kept for a start without network, and not past a week of those.
pub const APP: Key<Vec<u8>, Raw> = Key::new("app").keep(Keep::For(WEEK)).max_bytes(32 * 1024);
pub const APP_URL: Key<String> = Key::new("app_url").keep(Keep::For(WEEK)).max_bytes(512);
/// That app's local state and fetched data, restored at start.
pub const APP_DATA: Key<serde_json::Value> = Key::new("app_data").keep(Keep::For(WEEK)).max_bytes(8 * 1024);
/// The showcase's navigation, theme and images: a demo, so a day.
pub const SHOWCASE: Key<serde_json::Value> = Key::new("showcase").keep(Keep::For(DAY)).max_bytes(8 * 1024);

/// An NVS entry: what a key, a small value or a slice of a blob takes.
const NVS_ENTRY: usize = 32;

pub type Cache = matecrew_cache::Cache<Nvs>;

static CACHE: OnceLock<Cache> = OnceLock::new();

/// The terminal's cache, opened at the first call, in the `cache` NVS partition past the second
/// app slot: `partitions.csv`, which every USB flash writes, has it.
pub fn open() -> Result<&'static Cache> {
    if let Some(cache) = CACHE.get() {
        return Ok(cache);
    }
    let partition = EspCustomNvsPartition::take("cache").inspect_err(|e| log::error!("no cache partition, flash partitions.csv: {e}"))?;
    let nvs = Mutex::new(EspNvs::new(partition, "matecrew", true)?);
    Ok(CACHE.get_or_init(|| Cache::open(Nvs(nvs)).on_error(|e| log::warn!("cache: {e}"))))
}

/// What the cache holds, once it is open (the about page's storage gauge).
pub fn usage() -> Option<Usage> {
    CACHE.get().map(Cache::usage)
}

/// Entries as blobs in one NVS namespace. NVS keeps the old blob until the new one is written,
/// and skips a write of the same bytes.
pub struct Nvs(Mutex<EspNvs<NvsCustom>>);

impl Nvs {
    fn lock(&self) -> MutexGuard<'_, EspNvs<NvsCustom>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Backend for Nvs {
    fn read(&self, name: &str) -> Result<Option<Vec<u8>>, Error> {
        let nvs = self.lock();
        let Some(len) = nvs.blob_len(name).map_err(Error::backend)? else {
            return Ok(None);
        };
        let mut buf = vec![0u8; len];
        let read = nvs.get_blob(name, &mut buf).map_err(Error::backend)?.map(<[u8]>::len);
        Ok(read.map(|len| {
            buf.truncate(len);
            buf
        }))
    }

    fn write(&self, name: &str, bytes: &[u8]) -> Result<(), Error> {
        self.lock().set_blob(name, bytes).map_err(Error::backend)
    }

    fn remove(&self, name: &str) -> Result<(), Error> {
        self.lock().remove(name).map(drop).map_err(Error::backend)
    }

    fn names(&self) -> Result<Vec<String>, Error> {
        let nvs = self.lock();
        let mut keys = nvs.keys(Some(NvsDataType::Blob)).map_err(Error::backend)?;
        let mut names = Vec::new();
        while let Some((name, _)) = keys.next_key() {
            names.push(name.to_owned());
        }
        Ok(names)
    }

    fn capacity(&self) -> Option<usize> {
        let mut stats = nvs_stats_t { used_entries: 0, free_entries: 0, available_entries: 0, total_entries: 0, namespace_count: 0 };
        // SAFETY: a NUL-terminated partition name and a stats struct the call fills.
        (unsafe { nvs_get_stats(c"cache".as_ptr(), &mut stats) } == ESP_OK).then_some(stats.total_entries * NVS_ENTRY)
    }
}
