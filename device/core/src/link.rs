//! The terminal's Bluetooth LE link, as bytes: the protocol version, the GATT UUIDs, the JSON a
//! browser writes to set up or control the terminal, the events the terminal notifies, the frames
//! of a firmware update and their CRC-32. The GATT server is in the firmware (`ble.rs`), the
//! browser side in `device/sdk/link` (`@matecrew/device-link`), which mirrors this file.
//!
//! Nothing here is specific to an app: a site address and a link secret are opaque strings the
//! terminal stores, a badge is a hex UID.
//!
//! Protocol 1:
//! - `INFO` (read): JSON [`Info`], at most [`ATTRIBUTE_MAX`] bytes.
//! - `SETUP` (write, authenticated): JSON [`Setup`]; accepted while the terminal is not linked.
//! - `CONTROL` (write, authenticated): JSON [`Control`].
//! - `EVENTS` (notify, authenticated links only): JSON [`Event`], one per notification.
//! - `OTA` (write, authenticated): binary [`OtaFrame`]s.

use serde::{Deserialize, Serialize};

use crate::contract::Side;

/// Bumped when a message changes in a way an older peer would misread.
pub const PROTOCOL: u32 = 1;

pub const SERVICE: &str = "d3b70000-6b0e-4e4f-8c1a-5f3a2b1c0d00";
pub const INFO: &str = "d3b70001-6b0e-4e4f-8c1a-5f3a2b1c0d00";
pub const SETUP: &str = "d3b70002-6b0e-4e4f-8c1a-5f3a2b1c0d00";
pub const CONTROL: &str = "d3b70003-6b0e-4e4f-8c1a-5f3a2b1c0d00";
pub const EVENTS: &str = "d3b70004-6b0e-4e4f-8c1a-5f3a2b1c0d00";
pub const OTA: &str = "d3b70005-6b0e-4e4f-8c1a-5f3a2b1c0d00";

/// The longest value an attribute holds (Bluetooth Core, ATT).
pub const ATTRIBUTE_MAX: usize = 512;

/// What the terminal says about itself; readable without pairing, so nothing secret.
#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub protocol: u32,
    /// The name it advertises.
    pub name: String,
    /// Wi-Fi MAC, "AC:A7:04:2B:50:E4": what a site links it by.
    pub hardware_id: String,
    pub firmware: Firmware,
    /// It has a token from a site.
    pub linked: bool,
    /// `SETUP` is accepted (not linked).
    pub setup_open: bool,
    pub site: Option<String>,
    pub uptime: u64,
    /// Free internal heap, in bytes.
    pub heap: u32,
    pub wifi: Option<Wifi>,
    /// Networks it heard, strongest first; as many as fit in the attribute.
    pub networks: Vec<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
pub struct Firmware {
    pub version: String,
    pub build: String,
    pub commit: String,
    pub slot: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Wifi {
    pub ssid: String,
    pub rssi: Option<i8>,
}

impl Info {
    /// JSON within [`ATTRIBUTE_MAX`]: networks are dropped from the weakest until it fits.
    pub fn encode(&self) -> Vec<u8> {
        let mut info = self.clone();
        loop {
            let bytes = serde_json::to_vec(&info).unwrap_or_default();
            if bytes.len() <= ATTRIBUTE_MAX || info.networks.is_empty() {
                return bytes;
            }
            info.networks.pop();
        }
    }
}

/// Wi-Fi and, optionally, the site to use and a secret proving the site expects this terminal
/// (a pre-approved link). Written to `SETUP`.
#[derive(Deserialize, Debug, PartialEq)]
pub struct Setup {
    pub ssid: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub site: Option<String>,
    #[serde(default)]
    pub secret: Option<String>,
}

impl Setup {
    pub fn parse(bytes: &[u8]) -> Result<Self, LinkError> {
        let setup: Self = serde_json::from_slice(bytes).map_err(|_| LinkError::Malformed)?;
        // What a Wi-Fi station accepts (802.11: 32 bytes of SSID, 8 to 63 of passphrase).
        let password = setup.password.len();
        if setup.ssid.is_empty() || setup.ssid.len() > 32 || password > 64 || (1..8).contains(&password) {
            return Err(LinkError::Invalid("wifi"));
        }
        if setup.site.as_ref().is_some_and(|site| site.len() > 128) {
            return Err(LinkError::Invalid("site"));
        }
        if setup.secret.as_ref().is_some_and(|secret| secret.is_empty() || secret.len() > 128) {
            return Err(LinkError::Invalid("secret"));
        }
        Ok(setup)
    }
}

/// What a nearby browser asks the terminal to do. Written to `CONTROL`.
#[derive(Deserialize, Debug, PartialEq)]
#[serde(tag = "cmd", rename_all = "camelCase")]
pub enum Control {
    Key { side: Side },
    Both,
    Badge { uid: String },
    Sync,
    Restart,
    Notify { text: String },
}

impl Control {
    pub fn parse(bytes: &[u8]) -> Result<Self, LinkError> {
        let control: Self = serde_json::from_slice(bytes).map_err(|_| LinkError::Malformed)?;
        match &control {
            Self::Notify { text } if text.is_empty() || text.len() > 256 => Err(LinkError::Invalid("text")),
            _ => Ok(control),
        }
    }
}

/// What the terminal tells an authenticated browser, one per notification.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum Event {
    /// A line of the terminal's log.
    Log { level: char, target: String, msg: String },
    /// The answer to a `SETUP` or `CONTROL` write.
    Done { op: String, ok: bool, error: Option<String> },
    /// A firmware update: "ready", "writing", "done" or "failed".
    Ota { state: String, done: u32, total: u32, error: Option<String> },
}

impl Event {
    /// JSON within `max` bytes (the link's MTU less 3): a log line is shortened to fit.
    pub fn encode(&self, max: usize) -> Vec<u8> {
        let bytes = serde_json::to_vec(self).unwrap_or_default();
        let Self::Log { level, target, msg } = self else { return bytes };
        if bytes.len() <= max {
            return bytes;
        }
        let over = bytes.len() - max + "…".len();
        let mut keep = msg.len().saturating_sub(over);
        while !msg.is_char_boundary(keep) {
            keep -= 1;
        }
        let short = Self::Log { level: *level, target: target.clone(), msg: format!("{}…", &msg[..keep]) };
        serde_json::to_vec(&short).unwrap_or_default()
    }
}

/// One write to `OTA`. Little-endian integers.
#[derive(Debug, PartialEq)]
pub enum OtaFrame<'a> {
    /// `0x01`, size (u32), SHA-256 of the whole image (32 bytes), then the version (UTF-8).
    Begin { size: u32, sha256: [u8; 32], version: &'a str },
    /// `0x02`, offset (u32, the bytes written so far), CRC-32 of the data (u32), the data.
    Data { offset: u32, bytes: &'a [u8] },
    /// `0x03`: all written, check and switch to it.
    End,
    /// `0x04`: forget this update.
    Abort,
}

impl<'a> OtaFrame<'a> {
    pub fn parse(bytes: &'a [u8]) -> Result<Self, LinkError> {
        let u32_at = |at: usize| -> Result<u32, LinkError> {
            let four = bytes.get(at..at + 4).ok_or(LinkError::Malformed)?;
            Ok(u32::from_le_bytes(four.try_into().unwrap()))
        };
        match bytes.first() {
            Some(0x01) => {
                let size = u32_at(1)?;
                let sha256 = bytes.get(5..37).ok_or(LinkError::Malformed)?.try_into().unwrap();
                let version = core::str::from_utf8(&bytes[37..]).map_err(|_| LinkError::Malformed)?;
                Ok(Self::Begin { size, sha256, version })
            }
            Some(0x02) => {
                let offset = u32_at(1)?;
                let crc = u32_at(5)?;
                let data = &bytes[9..];
                if data.is_empty() {
                    return Err(LinkError::Malformed);
                }
                if crc32(data) != crc {
                    return Err(LinkError::Corrupt);
                }
                Ok(Self::Data { offset, bytes: data })
            }
            Some(0x03) if bytes.len() == 1 => Ok(Self::End),
            Some(0x04) if bytes.len() == 1 => Ok(Self::Abort),
            _ => Err(LinkError::Malformed),
        }
    }

    /// The frame as the browser writes it; for tests and tools.
    pub fn encode(&self) -> Vec<u8> {
        match self {
            Self::Begin { size, sha256, version } => {
                let mut out = vec![0x01];
                out.extend_from_slice(&size.to_le_bytes());
                out.extend_from_slice(sha256);
                out.extend_from_slice(version.as_bytes());
                out
            }
            Self::Data { offset, bytes } => {
                let mut out = vec![0x02];
                out.extend_from_slice(&offset.to_le_bytes());
                out.extend_from_slice(&crc32(bytes).to_le_bytes());
                out.extend_from_slice(bytes);
                out
            }
            Self::End => vec![0x03],
            Self::Abort => vec![0x04],
        }
    }
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum LinkError {
    /// Not the message's shape.
    Malformed,
    /// A field out of range: which one.
    Invalid(&'static str),
    /// A data frame whose CRC-32 does not match.
    Corrupt,
}

impl core::fmt::Display for LinkError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Malformed => f.write_str("malformed"),
            Self::Invalid(field) => write!(f, "invalid {field}"),
            Self::Corrupt => f.write_str("corrupt"),
        }
    }
}

/// CRC-32 (IEEE 802.3: reflected, polynomial 0xEDB88320, initial and final XOR 0xFFFFFFFF), as
/// zlib and the browser side compute it.
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_matches_the_standard_check_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }

    #[test]
    fn ota_frames_round_trip_and_a_bad_crc_is_caught() {
        let sha = [7u8; 32];
        let begin = OtaFrame::Begin { size: 1234, sha256: sha, version: "0.4.0" };
        assert_eq!(OtaFrame::parse(&begin.encode()).unwrap(), begin);
        let data = OtaFrame::Data { offset: 512, bytes: b"firmware" };
        let mut bytes = data.encode();
        assert_eq!(OtaFrame::parse(&bytes).unwrap(), data);
        *bytes.last_mut().unwrap() ^= 1;
        assert_eq!(OtaFrame::parse(&bytes), Err(LinkError::Corrupt));
        assert_eq!(OtaFrame::parse(&[0x03]).unwrap(), OtaFrame::End);
        assert_eq!(OtaFrame::parse(&[0x04]).unwrap(), OtaFrame::Abort);
        assert_eq!(OtaFrame::parse(&[0x02, 0, 0]), Err(LinkError::Malformed));
        assert_eq!(OtaFrame::parse(&[0x09]), Err(LinkError::Malformed));
    }

    #[test]
    fn setup_and_control_are_read_and_checked() {
        let setup = Setup::parse(br#"{"ssid":"Office","password":"pppppppp","site":"https://x.test","secret":"abc"}"#).unwrap();
        assert_eq!(setup.ssid, "Office");
        assert_eq!(setup.secret.as_deref(), Some("abc"));
        assert!(Setup::parse(br#"{"ssid":"Open"}"#).is_ok(), "an open network has no password");
        assert_eq!(Setup::parse(br#"{"ssid":"Office","password":"short"}"#), Err(LinkError::Invalid("wifi")));
        assert_eq!(Setup::parse(b"nope"), Err(LinkError::Malformed));

        assert_eq!(Control::parse(br#"{"cmd":"key","side":"left"}"#).unwrap(), Control::Key { side: Side::Left });
        assert_eq!(Control::parse(br#"{"cmd":"both"}"#).unwrap(), Control::Both);
        assert_eq!(Control::parse(br#"{"cmd":"badge","uid":"04A1"}"#).unwrap(), Control::Badge { uid: "04A1".into() });
        assert_eq!(Control::parse(br#"{"cmd":"notify","text":""}"#), Err(LinkError::Invalid("text")));
        assert_eq!(Control::parse(br#"{"cmd":"format"}"#), Err(LinkError::Malformed));
    }

    #[test]
    fn events_and_info_fit_their_limits() {
        let long = Event::Log { level: 'I', target: "app".into(), msg: "é".repeat(400) };
        let bytes = long.encode(180);
        assert!(bytes.len() <= 180, "{}", bytes.len());
        assert!(serde_json::from_slice::<serde_json::Value>(&bytes).is_ok());
        let done = Event::Done { op: "setup".into(), ok: true, error: None };
        assert_eq!(String::from_utf8(done.encode(180)).unwrap(), r#"{"t":"done","op":"setup","ok":true,"error":null}"#);

        let info = Info { protocol: PROTOCOL, networks: (0..100).map(|i| format!("Network {i}")).collect(), ..Default::default() };
        let bytes = info.encode();
        assert!(bytes.len() <= ATTRIBUTE_MAX);
        let back: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(back["protocol"], 1);
        assert!(!back["networks"].as_array().unwrap().is_empty());
    }
}
