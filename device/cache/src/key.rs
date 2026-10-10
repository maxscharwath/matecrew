//! Typed keys: what is cached, for how long and how big, said once where the key is declared.

use crate::entry::FOREVER;
use core::{fmt, marker::PhantomData, time::Duration};
use serde::{de::DeserializeOwned, Serialize};

pub const MINUTE: Duration = Duration::from_secs(60);
pub const HOUR: Duration = Duration::from_secs(60 * 60);
pub const DAY: Duration = Duration::from_secs(24 * 60 * 60);
pub const WEEK: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// What a key keeps when it does not say: small values, so a big one is a choice someone wrote.
pub const DEFAULT_MAX_BYTES: usize = 4 * 1024;
/// How long a key keeps when it does not say.
pub const DEFAULT_KEEP: Keep = Keep::For(DAY);

/// How long an entry is good for, from when it was written. Past that it reads as missing and
/// is removed. See [`crate::Cache`] for a clock that is not set yet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Keep {
    /// Until it is replaced or forgotten: for what the device needs to work offline.
    Forever,
    /// For this long after it was written.
    For(Duration),
}

impl Keep {
    /// The header's form: seconds, [`FOREVER`] for ever, at most about 136 years otherwise.
    pub(crate) const fn secs(self) -> u32 {
        match self {
            Keep::Forever => FOREVER,
            Keep::For(duration) if duration.as_secs() >= FOREVER as u64 => FOREVER - 1,
            Keep::For(duration) => duration.as_secs() as u32,
        }
    }
}

/// How a value becomes bytes and back. [`Json`] for anything serde reads and writes, [`Raw`] for
/// bytes kept as they are (bytecode, images), which JSON would triple.
pub trait Codec<T> {
    /// Appends the value's bytes to `out`.
    fn encode(value: &T, out: &mut Vec<u8>) -> Result<(), String>;
    /// The value these bytes hold, or `None` when they do not hold one (its type changed without
    /// a new [`Key::version`]): the entry is then dropped.
    fn decode(bytes: &[u8]) -> Option<T>;
}

/// JSON through serde: readable in a dump, tolerant of added optional fields.
pub struct Json;

impl<T: Serialize + DeserializeOwned> Codec<T> for Json {
    fn encode(value: &T, out: &mut Vec<u8>) -> Result<(), String> {
        serde_json::to_writer(out, value).map_err(|e| e.to_string())
    }

    fn decode(bytes: &[u8]) -> Option<T> {
        serde_json::from_slice(bytes).ok()
    }
}

/// Bytes as they are.
pub struct Raw;

impl Codec<Vec<u8>> for Raw {
    fn encode(value: &Vec<u8>, out: &mut Vec<u8>) -> Result<(), String> {
        out.extend_from_slice(value);
        Ok(())
    }

    fn decode(bytes: &[u8]) -> Option<Vec<u8>> {
        Some(bytes.to_vec())
    }
}

/// A cached value's name, type, lifetime and size limit. Declare keys as constants, together, so
/// one place says everything the device caches:
///
/// ```
/// use matecrew_cache::{Keep, Key, Raw, DAY};
/// # #[derive(serde::Serialize, serde::Deserialize)] struct State;
/// pub const STATE: Key<State> = Key::new("state").keep(Keep::Forever).max_bytes(96 * 1024);
/// pub const APP: Key<Vec<u8>, Raw> = Key::new("app").keep(Keep::For(DAY)).max_bytes(32 * 1024);
/// ```
pub struct Key<T, C = Json> {
    name: &'static str,
    keep: Keep,
    max_bytes: usize,
    version: u8,
    value: PhantomData<fn() -> (T, C)>,
}

impl<T, C> Key<T, C> {
    /// A key that keeps its value [`DEFAULT_KEEP`] and at most [`DEFAULT_MAX_BYTES`]. The name
    /// is 1 to 15 bytes, NVS's limit, checked when the constant is built.
    pub const fn new(name: &'static str) -> Self {
        assert!(!name.is_empty() && name.len() <= 15, "a cache key's name is 1 to 15 bytes");
        Self { name, keep: DEFAULT_KEEP, max_bytes: DEFAULT_MAX_BYTES, version: 1, value: PhantomData }
    }

    pub const fn keep(self, keep: Keep) -> Self {
        Self { keep, ..self }
    }

    /// The most the value may take, encoded; a bigger one is not kept (`Error::TooLarge`) and the
    /// old one stays.
    pub const fn max_bytes(self, max_bytes: usize) -> Self {
        Self { max_bytes, ..self }
    }

    /// The value's shape: bump it when the type changes in a way that would still decode wrongly.
    /// Entries written with another version read as missing.
    pub const fn version(self, version: u8) -> Self {
        Self { version, ..self }
    }

    pub const fn name(&self) -> &'static str {
        self.name
    }

    pub const fn kept(&self) -> Keep {
        self.keep
    }

    pub const fn limit(&self) -> usize {
        self.max_bytes
    }

    pub(crate) const fn shape(&self) -> u8 {
        self.version
    }
}

// By hand: derives would ask `T: Clone`, though a key holds no `T`.
impl<T, C> Clone for Key<T, C> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T, C> Copy for Key<T, C> {}

impl<T, C> fmt::Debug for Key<T, C> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Key")
            .field("name", &self.name)
            .field("keep", &self.keep)
            .field("max_bytes", &self.max_bytes)
            .field("version", &self.version)
            .finish()
    }
}
