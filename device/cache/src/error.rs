use core::fmt;

/// What can go wrong. `put` returns the first three; `Dropped` only goes to the cache's
/// `on_error` hook, since the read that found it answers `None` like any miss.
pub enum Error {
    /// The value is bigger than its key's `max_bytes`: not kept.
    TooLarge { key: &'static str, bytes: usize, max: usize },
    /// The value could not be encoded.
    Encode { key: &'static str, message: String },
    /// The storage failed.
    Backend(Box<dyn std::error::Error + Send + Sync>),
    /// An entry that did not read back (another format or version, bad checksum, a value that
    /// no longer decodes): removed.
    Dropped { key: String, why: &'static str },
}

impl Error {
    /// A storage error, from a [`crate::Backend`].
    pub fn backend(error: impl Into<Box<dyn std::error::Error + Send + Sync>>) -> Self {
        Self::Backend(error.into())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLarge { key, bytes, max } => write!(f, "{key}: {bytes} bytes, over its {max}"),
            Self::Encode { key, message } => write!(f, "{key}: not encoded: {message}"),
            Self::Backend(error) => write!(f, "storage: {error}"),
            Self::Dropped { key, why } => write!(f, "{key}: dropped, {why}"),
        }
    }
}

// The message, as `Display`: a derived `Debug` took 200 more bytes of firmware for no reader.
impl fmt::Debug for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Backend(error) => Some(error.as_ref()),
            _ => None,
        }
    }
}
