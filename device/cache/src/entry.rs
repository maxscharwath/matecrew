//! An entry as a backend stores it: a 20-byte header, then the value's bytes.
//!
//! ```text
//! 0..2    "mc"
//! 2       FORMAT: this layout's version
//! 3       the key's version (`Key::version`)
//! 4..8    written at, Unix seconds (u32 LE); 0 when the clock was not set
//! 8..12   keep, seconds (u32 LE); u32::MAX for ever
//! 12..16  the value's length (u32 LE)
//! 16..20  CRC-32 (IEEE, as zlib) of the value, then of bytes 0..16
//! ```
//!
//! The value comes first in the CRC so its running state is the value's digest: the cache tells
//! an unchanged value from it without a second pass, and dates an entry without reading the value
//! again.

pub(crate) const HEADER: usize = 20;
const MAGIC: [u8; 2] = *b"mc";
/// Entries in another layout read as missing: bump it when the header changes.
const FORMAT: u8 = 1;
/// `keep` for an entry that does not expire.
pub(crate) const FOREVER: u32 = u32::MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Header {
    pub version: u8,
    /// Unix seconds, 0 when the clock was not set.
    pub written: u32,
    /// Seconds, [`FOREVER`] for no expiry.
    pub keep: u32,
}

impl Header {
    /// Seconds since the epoch past which the entry is stale; `None` for ever or when it was
    /// written before the clock was set.
    pub fn expires(self) -> Option<u64> {
        (self.keep != FOREVER && self.written != 0).then(|| u64::from(self.written) + u64::from(self.keep))
    }
}

/// A buffer with room for the header, for a codec to append the value to.
pub(crate) fn buffer() -> Vec<u8> {
    vec![0; HEADER]
}

/// The digest of the value `entry` holds after [`HEADER`]: equal digests and lengths, same value.
pub(crate) fn digest(entry: &[u8]) -> Crc {
    Crc::new().update(&entry[HEADER..])
}

/// Fills the header in front of the value, whose [`digest`] is `value`.
pub(crate) fn seal(entry: &mut [u8], header: Header, value: Crc) {
    let len = (entry.len() - HEADER) as u32;
    entry[0..2].copy_from_slice(&MAGIC);
    entry[2] = FORMAT;
    entry[3] = header.version;
    entry[4..8].copy_from_slice(&header.written.to_le_bytes());
    entry[8..12].copy_from_slice(&header.keep.to_le_bytes());
    entry[12..16].copy_from_slice(&len.to_le_bytes());
    let crc = value.update(&entry[..16]).finish();
    entry[16..20].copy_from_slice(&crc.to_le_bytes());
}

/// The header and value digest of a whole, intact entry, or why it is not one.
pub(crate) fn open(entry: &[u8]) -> Result<(Header, Crc), &'static str> {
    if entry.len() < HEADER || entry[0..2] != MAGIC {
        return Err("not a cache entry");
    }
    if entry[2] != FORMAT {
        return Err("another format");
    }
    let u32_at = |at: usize| u32::from_le_bytes([entry[at], entry[at + 1], entry[at + 2], entry[at + 3]]);
    if u32_at(12) as usize != entry.len() - HEADER {
        return Err("truncated");
    }
    let value = digest(entry);
    if u32_at(16) != value.update(&entry[..16]).finish() {
        return Err("bad checksum");
    }
    Ok((Header { version: entry[3], written: u32_at(4), keep: u32_at(8) }, value))
}

/// A CRC-32 table a nibble wide: 64 bytes of flash, where a byte-wide one takes 1 KB, for about
/// four times the bitwise loop's speed (a 50 KB state is checked at every start).
const TABLE: [u32; 16] = {
    let mut table = [0u32; 16];
    let mut n = 0;
    while n < 16 {
        let mut c = n as u32;
        let mut k = 0;
        while k < 4 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        table[n] = c;
        n += 1;
    }
    table
};

/// A running CRC-32 (IEEE 802.3: reflected, polynomial 0xEDB88320, initial and final XOR
/// 0xFFFFFFFF), fed part by part.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Crc(u32);

impl Crc {
    pub fn new() -> Self {
        Self(!0)
    }

    pub fn update(self, bytes: &[u8]) -> Self {
        Self(bytes.iter().fold(self.0, |crc, &byte| {
            let crc = crc ^ u32::from(byte);
            let crc = TABLE[(crc & 0xF) as usize] ^ (crc >> 4);
            TABLE[(crc & 0xF) as usize] ^ (crc >> 4)
        }))
    }

    pub fn finish(self) -> u32 {
        !self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_matches_the_standard_check_value() {
        assert_eq!(Crc::new().update(b"123456789").finish(), 0xCBF4_3926);
        assert_eq!(Crc::new().update(b"1234").update(b"56789").finish(), 0xCBF4_3926);
        assert_eq!(Crc::new().finish(), 0);
    }

    #[test]
    fn a_sealed_entry_opens_and_any_flipped_bit_does_not() {
        let mut entry = buffer();
        entry.extend_from_slice(b"{\"stock\":36}");
        let header = Header { version: 3, written: 1_760_000_000, keep: 86_400 };
        let value = digest(&entry);
        seal(&mut entry, header, value);
        assert_eq!(open(&entry), Ok((header, value)));
        for at in 0..entry.len() {
            let mut bad = entry.clone();
            bad[at] ^= 0x10;
            assert!(open(&bad).is_err(), "byte {at}");
        }
        assert_eq!(open(&entry[..entry.len() - 1]), Err("truncated"));
        assert_eq!(open(b"{\"stock\":36}"), Err("not a cache entry"));
    }
}
