//! What the cache holds, for an about page or a log line: `println!("{}", cache.usage())`.

use crate::entry::{Header, FOREVER};
use core::{fmt, time::Duration};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Usage {
    /// Bytes the entries take, headers included.
    pub used: usize,
    /// The backend's capacity, when it knows.
    pub total: Option<usize>,
    /// Largest first.
    pub entries: Vec<Entry>,
    /// The clock when this was taken, `None` while it is not set: what `expires` is counted from.
    pub now: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub key: String,
    /// Header included.
    pub bytes: usize,
    /// Unix seconds; `None` when written before the clock was set.
    pub written: Option<u64>,
    pub expires: Expires,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Expires {
    Never,
    /// Unix seconds.
    At(u64),
    /// Written before the clock was set: it keeps this long from the first read with a set clock.
    Pending(Duration),
}

/// An entry as `usage` lists it, from its header.
pub(crate) fn entry(key: &str, bytes: usize, header: Header) -> Entry {
    Entry {
        key: key.to_owned(),
        bytes,
        written: (header.written != 0).then_some(u64::from(header.written)),
        expires: match (header.keep, header.expires()) {
            (FOREVER, _) => Expires::Never,
            (_, Some(at)) => Expires::At(at),
            (keep, None) => Expires::Pending(Duration::from_secs(u64::from(keep))),
        },
    }
}

impl fmt::Display for Usage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let count = self.entries.len();
        write!(f, "{} in {count} {}", Size(self.used), if count == 1 { "entry" } else { "entries" })?;
        if let Some(total) = self.total {
            write!(f, " of {}", Size(total))?;
        }
        for entry in &self.entries {
            write!(f, "\n  {:<15} {:>9}  ", entry.key, Size(entry.bytes).to_string())?;
            match (entry.expires, self.now) {
                (Expires::Never, _) => f.write_str("kept for ever")?,
                (Expires::At(at), Some(now)) if at <= now => f.write_str("expired")?,
                (Expires::At(at), Some(now)) => write!(f, "{} left", Span(at - now))?,
                (Expires::At(_), None) => f.write_str("kept until the clock is set")?,
                (Expires::Pending(keep), _) => write!(f, "{} once the clock is set", Span(keep.as_secs()))?,
            }
        }
        Ok(())
    }
}

struct Size(usize);

impl fmt::Display for Size {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            bytes if bytes < 1024 => write!(f, "{bytes} B"),
            bytes => write!(f, "{:.1} KB", bytes as f32 / 1024.0),
        }
    }
}

struct Span(u64);

impl fmt::Display for Span {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (days, hours, minutes) = (self.0 / 86_400, self.0 / 3_600 % 24, self.0 / 60 % 60);
        match (days, hours, minutes) {
            (0, 0, 0) => write!(f, "{} s", self.0),
            (0, 0, m) => write!(f, "{m} min"),
            (0, h, m) => write!(f, "{h} h {m} min"),
            (d, h, _) => write!(f, "{d} d {h} h"),
        }
    }
}
