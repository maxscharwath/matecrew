//! The link a person scans to claim an unknown badge: the site's /badge page
//! with the terminal, the UID and the time, signed so the site knows this
//! terminal really read that badge a moment ago.
//!
//! The key is the SHA-256 of the terminal's token, which the site keeps
//! anyway (it stores only that hash). The signature is the first 16 bytes of
//! an HMAC-SHA256 of `device|uid|unix`, in base64url without padding.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

/// What the terminal needs to sign a claim link.
#[derive(Clone, Copy)]
pub struct Claim<'a> {
    /// "https://matecrew.vercel.app", without the trailing slash.
    pub site: &'a str,
    pub device_id: &'a str,
    /// SHA-256 of the token.
    pub key: &'a [u8; 32],
}

/// The key from the token, computed once.
pub fn key(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

pub fn signature(key: &[u8], device_id: &str, uid: &str, unix: i64) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC takes any key length");
    mac.update(format!("{device_id}|{uid}|{unix}").as_bytes());
    base64url(&mac.finalize().into_bytes()[..16])
}

impl Claim<'_> {
    pub fn url(&self, uid: &str, unix: i64) -> String {
        let sig = signature(self.key, self.device_id, uid, unix);
        format!("{}/badge?d={}&u={uid}&t={unix}&s={sig}", self.site.trim_end_matches('/'), self.device_id)
    }
}

fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
        for i in 0..=chunk.len() {
            out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_like_the_site() {
        let key = key("mcd_test-token");
        let claim = Claim { site: "http://localhost:3000/", device_id: "dev1", key: &key };
        assert_eq!(
            claim.url("04A1B2C3D4E5F6", 1_791_570_300),
            format!(
                "http://localhost:3000/badge?d=dev1&u=04A1B2C3D4E5F6&t=1791570300&s={}",
                signature(&key, "dev1", "04A1B2C3D4E5F6", 1_791_570_300)
            )
        );
        // The site signs the same way (src/lib/device/badge-claim.ts); this value comes from Node crypto.
        assert_eq!(signature(&key, "dev1", "04A1B2C3D4E5F6", 1_791_570_300), "1XA8_wdH3MGEW6rDCHsTew");
    }

    #[test]
    fn encodes_base64url() {
        assert_eq!(base64url(b"Man"), "TWFu");
        assert_eq!(base64url(b"Ma"), "TWE");
        assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
    }
}
