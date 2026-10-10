//! Where entries live. The cache only needs named blobs; the firmware puts them in NVS
//! (`firmware/src/cache.rs`), tests and wasm in memory.

use crate::Error;
use std::{collections::BTreeMap, sync::Mutex};

/// Named blobs, whole: an entry is always read and written in one piece.
pub trait Backend {
    /// The bytes stored under `name`, or `None`.
    fn read(&self, name: &str) -> Result<Option<Vec<u8>>, Error>;
    /// Stores `bytes` under `name`, replacing what was there. A backend that can should keep the
    /// old bytes until the new ones are safe (NVS does), so a power cut loses nothing.
    fn write(&self, name: &str, bytes: &[u8]) -> Result<(), Error>;
    /// Removes `name`; nothing to remove is not an error.
    fn remove(&self, name: &str) -> Result<(), Error>;
    /// Every name stored, for `usage` and `clear`.
    fn names(&self) -> Result<Vec<String>, Error>;
    /// The room the medium has in all, in bytes, when it knows.
    fn capacity(&self) -> Option<usize> {
        None
    }
}

/// A backend chosen at run time (`Box<dyn Backend + Send + Sync>`), or borrowed.
macro_rules! forward {
    ($($ty:ty),*) => {$(
        impl<B: Backend + ?Sized> Backend for $ty {
            fn read(&self, name: &str) -> Result<Option<Vec<u8>>, Error> {
                (**self).read(name)
            }
            fn write(&self, name: &str, bytes: &[u8]) -> Result<(), Error> {
                (**self).write(name, bytes)
            }
            fn remove(&self, name: &str) -> Result<(), Error> {
                (**self).remove(name)
            }
            fn names(&self) -> Result<Vec<String>, Error> {
                (**self).names()
            }
            fn capacity(&self) -> Option<usize> {
                (**self).capacity()
            }
        }
    )*};
}

forward!(Box<B>, &B);

/// Entries in RAM: for tests and the browser.
#[derive(Default)]
pub struct MemoryBackend(Mutex<BTreeMap<String, Vec<u8>>>);

impl MemoryBackend {
    pub fn new() -> Self {
        Self::default()
    }

    fn entries(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, Vec<u8>>> {
        // A panic while holding the lock leaves whole entries: keep going.
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The raw bytes of an entry, header included: for tests that damage one.
    pub fn raw(&self, name: &str) -> Option<Vec<u8>> {
        self.entries().get(name).cloned()
    }
}

impl Backend for MemoryBackend {
    fn read(&self, name: &str) -> Result<Option<Vec<u8>>, Error> {
        Ok(self.entries().get(name).cloned())
    }
    fn write(&self, name: &str, bytes: &[u8]) -> Result<(), Error> {
        self.entries().insert(name.to_owned(), bytes.to_vec());
        Ok(())
    }
    fn remove(&self, name: &str) -> Result<(), Error> {
        self.entries().remove(name);
        Ok(())
    }
    fn names(&self) -> Result<Vec<String>, Error> {
        Ok(self.entries().keys().cloned().collect())
    }
}
