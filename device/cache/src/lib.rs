//! What a device keeps between restarts that it could fetch again: declared as typed keys that
//! say how long and how big, checked when read back.
//!
//! ```
//! use matecrew_cache::{Cache, Keep, Key, MemoryBackend, Raw, DAY};
//!
//! const STOCK: Key<Vec<u32>> = Key::new("stock").keep(Keep::Forever);
//! const APP: Key<Vec<u8>, Raw> = Key::new("app").keep(Keep::For(DAY)).max_bytes(32 * 1024);
//!
//! let cache = Cache::open(MemoryBackend::new());
//! cache.put(&STOCK, &vec![36, 12])?;
//! assert_eq!(cache.get(&STOCK)?, Some(vec![36, 12]));
//! let app = cache.remember(&APP, || Ok::<_, std::io::Error>(b"DUI1".to_vec()))?;
//! cache.forget(&APP)?;
//! println!("{}", cache.usage()); // "27 B in 1 entry", then a line per entry
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! # Rules
//!
//! - A read answers `None` for a missing entry, and also for one that expired, is corrupt, was
//!   written in another header format or with another [`Key::version`], or no longer decodes:
//!   such an entry is removed as it is found.
//! - Limits apply on `put`: a value over its key's `max_bytes` is refused, and the old one stays.
//! - **Clock.** Expiry is wall-clock time, and a device's clock may not be set yet (the terminal
//!   gets it over NTP or from the site). A clock before [`CLOCK_SET_AFTER`] is not set. While it
//!   is not, nothing expires. An entry written while it was not set has no date: its `keep`
//!   starts at the first read with a set clock, which dates it. A clock that went back makes an
//!   entry younger, never older.
//! - The shorter of the key's `keep` and the one the entry was written with applies, so a key
//!   whose `keep` shrinks in a new firmware also shortens what an older one wrote.

mod backend;
mod entry;
mod error;
mod key;
mod usage;

pub use backend::{Backend, MemoryBackend};
pub use error::Error;
pub use key::{Codec, Json, Keep, Key, Raw, DAY, DEFAULT_KEEP, DEFAULT_MAX_BYTES, HOUR, MINUTE, WEEK};
pub use usage::{Entry, Expires, Usage};

use entry::{Crc, Header, FOREVER, HEADER};
use std::sync::{Mutex, MutexGuard};

/// 2024-01-01 in Unix seconds: a clock before it has not been set (a device that just started
/// counts from 1970).
pub const CLOCK_SET_AFTER: u64 = 1_704_067_200;

/// Typed entries over a [`Backend`]. Shareable between threads when the backend is.
pub struct Cache<B> {
    backend: B,
    clock: fn() -> Option<u64>,
    on_error: fn(&Error),
    index: Mutex<Index>,
}

/// What is known of the entries without reading them again, so `usage` costs no flash reads past
/// the first. `complete` once every stored name was looked at. A vector sorted
/// by name: a device caches a handful of entries, and a `BTreeMap` took 7 KB of firmware.
#[derive(Default)]
struct Index {
    entries: Vec<(String, Meta)>,
    complete: bool,
}

#[derive(Clone, Copy)]
struct Meta {
    bytes: usize,
    header: Header,
    /// The value's digest, to leave an unchanged value unwritten.
    value: Crc,
}

impl Index {
    fn find(&self, name: &str) -> Result<usize, usize> {
        self.entries.binary_search_by(|(key, _)| key.as_str().cmp(name))
    }

    fn get(&self, name: &str) -> Option<Meta> {
        self.find(name).ok().map(|at| self.entries[at].1)
    }

    fn insert(&mut self, name: &str, meta: Meta) {
        match self.find(name) {
            Ok(at) => self.entries[at].1 = meta,
            Err(at) => self.entries.insert(at, (name.to_owned(), meta)),
        }
    }

    fn remove(&mut self, name: &str) {
        if let Ok(at) = self.find(name) {
            self.entries.remove(at);
        }
    }
}

impl<B: Backend> Cache<B> {
    /// A cache on the system clock, whose errors only `put` reports.
    pub fn open(backend: B) -> Self {
        Self { backend, clock: system_clock, on_error: |_| {}, index: Mutex::default() }
    }

    /// Unix seconds, `None` when unknown. The system clock by default (none on wasm).
    pub fn clock(mut self, now: fn() -> Option<u64>) -> Self {
        self.clock = now;
        self
    }

    /// Hears what a read cannot return: entries dropped, storage failures inside `remember`.
    pub fn on_error(mut self, report: fn(&Error)) -> Self {
        self.on_error = report;
        self
    }

    pub fn backend(&self) -> &B {
        &self.backend
    }

    /// The value, or `None` when it is missing, expired, corrupt or from another format.
    pub fn get<T, C: Codec<T>>(&self, key: &Key<T, C>) -> Result<Option<T>, Error> {
        let Some(entry) = self.load(key.name(), Some(key.shape()), key.kept().secs())? else {
            return Ok(None);
        };
        let value = C::decode(&entry[HEADER..]);
        if value.is_none() {
            self.drop_entry(key.name(), "value does not decode");
        }
        Ok(value)
    }

    /// Keeps the value under its key, replacing what was there. The same value again is not
    /// written (the terminal syncs every two minutes: rewriting its state each time would wear
    /// the flash and drain the battery), unless half its keep has passed: it is then dated again,
    /// so a value that is still current does not expire.
    pub fn put<T, C: Codec<T>>(&self, key: &Key<T, C>, value: &T) -> Result<(), Error> {
        let mut entry = entry::buffer();
        C::encode(value, &mut entry).map_err(|message| Error::Encode { key: key.name(), message })?;
        let header = Header { version: key.shape(), written: self.now().unwrap_or(0), keep: key.kept().secs() };
        self.store(key.name(), key.limit(), header, entry)
    }

    /// The value if it is there, or else what `compute` gives, kept for next time. Only
    /// `compute`'s error comes back: the cache failing to read or keep is not the caller's
    /// problem, and goes to `on_error`.
    pub fn remember<T, C: Codec<T>, E>(&self, key: &Key<T, C>, compute: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
        match self.get(key) {
            Ok(Some(value)) => return Ok(value),
            Ok(None) => {}
            Err(error) => (self.on_error)(&error),
        }
        let value = compute()?;
        if let Err(error) = self.put(key, &value) {
            (self.on_error)(&error);
        }
        Ok(value)
    }

    pub fn forget<T, C>(&self, key: &Key<T, C>) -> Result<(), Error> {
        self.remove(key.name())
    }

    /// Removes every entry, with names no key declares any more.
    pub fn clear(&self) -> Result<(), Error> {
        for name in self.backend.names()? {
            self.remove(&name)?;
        }
        Ok(())
    }

    /// Every entry with its size and expiry, largest first. The first call reads the entries no
    /// `get` has read yet (dropping what expired or broke); later ones cost nothing.
    pub fn usage(&self) -> Usage {
        self.complete_index();
        let mut entries: Vec<Entry> = self.index().entries.iter().map(|(key, meta)| usage::entry(key, meta.bytes, meta.header)).collect();
        // By name already: an insertion sort keeps that order among equal sizes, in a fraction of
        // the flash the library's sorts take, for a handful of entries.
        for sorted in 1..entries.len() {
            let mut at = sorted;
            while at > 0 && entries[at - 1].bytes < entries[at].bytes {
                entries.swap(at - 1, at);
                at -= 1;
            }
        }
        Usage {
            used: entries.iter().map(|e| e.bytes).sum(),
            total: self.backend.capacity(),
            entries,
            now: self.now().map(u64::from),
        }
    }

    /// The clock in the header's form, `None` while it is not set.
    fn now(&self) -> Option<u32> {
        (self.clock)().filter(|&now| now >= CLOCK_SET_AFTER).map(|now| now.min(u64::from(u32::MAX - 1)) as u32)
    }

    fn index(&self) -> MutexGuard<'_, Index> {
        self.index.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// `put` past the encoding, compiled once for every value type.
    fn store(&self, name: &'static str, limit: usize, header: Header, mut entry: Vec<u8>) -> Result<(), Error> {
        let bytes = entry.len() - HEADER;
        if bytes > limit {
            return Err(Error::TooLarge { key: name, bytes, max: limit });
        }
        let digest = entry::digest(&entry);
        let kept = self.index().get(name);
        if kept.is_some_and(|kept| kept.value == digest && kept.bytes == entry.len() && !redate(kept.header, header)) {
            return Ok(());
        }
        entry::seal(&mut entry, header, digest);
        self.backend.write(name, &entry)?;
        self.index().insert(name, Meta { bytes: entry.len(), header, value: digest });
        Ok(())
    }

    /// A whole, current entry, or `None` after dropping it. `version` and `keep` are the key's
    /// when a key asks; the scan for `usage` only knows the header.
    fn load(&self, name: &str, version: Option<u8>, keep: u32) -> Result<Option<Vec<u8>>, Error> {
        let Some(mut entry) = self.backend.read(name)? else {
            self.index().remove(name);
            return Ok(None);
        };
        let (mut header, value) = match entry::open(&entry) {
            Ok(opened) => opened,
            Err(why) => {
                self.drop_entry(name, why);
                return Ok(None);
            }
        };
        if version.is_some_and(|version| version != header.version) {
            self.drop_entry(name, "another version");
            return Ok(None);
        }
        let keep = keep.min(header.keep);
        match self.now() {
            Some(now) if keep != FOREVER && header.written == 0 => {
                // Written before the clock was set: its keep starts now.
                header.written = now;
                entry::seal(&mut entry, header, value);
                self.backend.write(name, &entry)?;
            }
            Some(now) if keep != FOREVER && u64::from(now) >= u64::from(header.written) + u64::from(keep) => {
                self.remove(name)?;
                return Ok(None);
            }
            _ => {}
        }
        self.index().insert(name, Meta { bytes: entry.len(), header, value });
        Ok(Some(entry))
    }

    fn remove(&self, name: &str) -> Result<(), Error> {
        self.backend.remove(name)?;
        self.index().remove(name);
        Ok(())
    }

    /// Removes an entry that did not read back, and says so.
    fn drop_entry(&self, name: &str, why: &'static str) {
        if let Err(error) = self.remove(name) {
            (self.on_error)(&error);
        }
        (self.on_error)(&Error::Dropped { key: name.to_owned(), why });
    }

    /// Reads, once, the entries no `get` has: their sizes and expiries, for `usage`.
    fn complete_index(&self) {
        if self.index().complete {
            return;
        }
        let names = match self.backend.names() {
            Ok(names) => names,
            Err(error) => return (self.on_error)(&error),
        };
        self.index().entries.retain(|(name, _)| names.contains(name));
        for name in names {
            if self.index().get(&name).is_some() {
                continue;
            }
            if let Err(error) = self.load(&name, None, FOREVER) {
                (self.on_error)(&error);
            }
        }
        self.index().complete = true;
    }
}

/// Whether an entry holding the same value as a new one is written anyway: another version or
/// keep, no date while the clock now has one, or half its keep gone.
fn redate(kept: Header, new: Header) -> bool {
    if kept.version != new.version || kept.keep != new.keep {
        return true;
    }
    match (kept.keep, kept.written, new.written) {
        (FOREVER, _, _) | (_, _, 0) => false,
        (_, 0, _) => true,
        (keep, written, now) => u64::from(now) >= u64::from(written) + u64::from(keep / 2),
    }
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
fn system_clock() -> Option<u64> {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok().map(|since| since.as_secs())
}

/// The browser's wasm has no system clock (`SystemTime::now` panics there): pass one to
/// [`Cache::clock`] to have entries expire.
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn system_clock() -> Option<u64> {
    None
}

#[cfg(test)]
mod tests;
