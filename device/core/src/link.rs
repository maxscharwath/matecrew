//! The terminal's Bluetooth LE link, as bytes: the protocol version, the GATT UUIDs, the JSON a
//! browser writes to set up or control the terminal, the events the terminal notifies, the frames
//! of a firmware update and their CRC-32, the updates of its screen mirror. The GATT server is in
//! the firmware (`ble.rs`), the browser side in `device/sdk/link` (`@matecrew/device-link`), which
//! mirrors this file.
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
//! - `SCREEN` (notify, authenticated links only; write, authenticated): the panel, live, while the
//!   browser is subscribed: [`screen_update`]s cut by [`screen_notification`]. Writes are
//!   [`ScreenRequest`]s: the whole screen again, a tap on it.
//!
//! `SCREEN` came later within protocol 1: an addition an older peer does not misread (an older
//! terminal has no such characteristic).

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
pub const SCREEN: &str = "d3b70006-6b0e-4e4f-8c1a-5f3a2b1c0d00";

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

/// A write to `SCREEN`.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ScreenRequest {
    /// `0x01`: send the whole screen next, to start watching or after a lost notification.
    Whole,
    /// `0x02`, x, y: a touch on the screen at (x, y) of the remote taps' 200 x 120 grid.
    Tap { x: u8, y: u8 },
}

impl ScreenRequest {
    pub fn parse(bytes: &[u8]) -> Result<Self, LinkError> {
        match *bytes {
            [0x01] => Ok(Self::Whole),
            [0x02, x, y] if x < 200 && y < 120 => Ok(Self::Tap { x, y }),
            [0x02, _, _] => Err(LinkError::Invalid("tap")),
            _ => Err(LinkError::Malformed),
        }
    }
}

/// Flags of a `SCREEN` notification: it starts an update, it ends one.
pub const SCREEN_FIRST: u8 = 0x01;
pub const SCREEN_LAST: u8 = 0x02;

/// Update kinds: the whole screen, a band of rows replaced, a band of rows XORed into the screen.
const SCREEN_KEY: u8 = 0x01;
const SCREEN_ROWS: u8 = 0x02;
const SCREEN_XOR: u8 = 0x03;
/// Kind, width, height, first row and rows (u16 each), CRC-32 of the updated screen.
const SCREEN_HEADER: usize = 13;

/// One update of the screen mirror, from `before` (what the browser has; `None` for the whole
/// screen) to `after`, or `None` when no row changed. A screen is packed rows of `width` pixels,
/// most significant bit first, 1 = ink, as the panel takes them. Little-endian integers:
///
/// - kind: `0x01` the whole screen, `0x02` a band of rows replaced, `0x03` a band XORed in;
/// - width and height (u16) of the whole screen, the same in every update;
/// - first row and rows (u16): the band that changed;
/// - CRC-32 of the whole screen once updated: a browser that ends up elsewhere asks for it whole;
/// - the band's bytes, run-length coded ([`rle`]). Replaced rows go XORed with the row above them
///   in the new screen (zeros above the top one), so plain areas and vertical edges become runs;
///   a 1-bit UI screen takes 3 to 11 KB of the 48 000 bytes. XORed rows are the changed bits
///   alone, smaller when little changed within the band (a clock); the smaller of the two goes.
pub fn screen_update(before: Option<&[u8]>, after: &[u8], width: u16, height: u16) -> Option<Vec<u8>> {
    let stride = usize::from(width).div_ceil(8);
    let (top, bottom) = match before {
        None => (0, usize::from(height)),
        Some(before) => {
            let changed = |y: &usize| before[y * stride..(y + 1) * stride] != after[y * stride..(y + 1) * stride];
            let top = (0..usize::from(height)).find(changed)?;
            (top, (top..usize::from(height)).rfind(changed)? + 1)
        }
    };
    let (start, end) = (top * stride, bottom * stride);
    let mut update = vec![if before.is_some() { SCREEN_ROWS } else { SCREEN_KEY }];
    for value in [width, height, top as u16, (bottom - top) as u16] {
        update.extend_from_slice(&value.to_le_bytes());
    }
    update.extend_from_slice(&crc32(after).to_le_bytes());
    // Each row XOR the one above it; the top row of the screen stays as it is.
    let mut band = after[start..end].to_vec();
    let skip = if start == 0 { stride } else { 0 };
    for (byte, above) in band[skip..].iter_mut().zip(&after[start + skip - stride..end - stride]) {
        *byte ^= above;
    }
    rle(&band, &mut update);
    if let Some(before) = before {
        band.copy_from_slice(&after[start..end]);
        for (byte, was) in band.iter_mut().zip(&before[start..end]) {
            *byte ^= was;
        }
        let mut xored = update[..SCREEN_HEADER].to_vec();
        xored[0] = SCREEN_XOR;
        rle(&band, &mut xored);
        if xored.len() < update.len() {
            return Some(xored);
        }
    }
    Some(update)
}

/// Run-length coding: `0x00..=0x7F`, then that many plus one bytes as they are; `0x80..=0xFE`,
/// then one byte repeated that many less 0x80 plus 3 times; `0xFF`, one byte and a LEB128 count,
/// the byte repeated 130 times plus the count.
fn rle(bytes: &[u8], out: &mut Vec<u8>) {
    let literal = |out: &mut Vec<u8>, literal: &[u8]| {
        for part in literal.chunks(128) {
            out.push((part.len() - 1) as u8);
            out.extend_from_slice(part);
        }
    };
    let (mut from, mut at) = (0, 0);
    while at < bytes.len() {
        let value = bytes[at];
        let run = bytes[at..].iter().take_while(|&&byte| byte == value).count();
        if run >= 3 {
            literal(out, &bytes[from..at]);
            let extra = run - 3;
            if extra < 0x7F {
                out.extend([0x80 | extra as u8, value]);
            } else {
                out.extend([0xFF, value]);
                let mut count = extra - 0x7F;
                while count >= 0x80 {
                    out.push(count as u8 | 0x80);
                    count >>= 7;
                }
                out.push(count as u8);
            }
            from = at + run;
        }
        at += run;
    }
    literal(out, &bytes[from..]);
}

/// The `SCREEN` notification `index` of `update` into `out`, false past the last one. Each is at
/// most `room` bytes (the link's MTU less 3): its number `seq`, one more than the notification
/// before, wrapping; flags ([`SCREEN_FIRST`], [`SCREEN_LAST`]); the next part of the update. A gap
/// in the numbers tells the browser a notification was lost.
pub fn screen_notification(update: &[u8], room: usize, index: usize, seq: u8, out: &mut Vec<u8>) -> bool {
    let part = room.saturating_sub(2).max(1);
    let start = index * part;
    if start >= update.len() {
        return false;
    }
    let end = update.len().min(start + part);
    let first = if index == 0 { SCREEN_FIRST } else { 0 };
    let last = if end == update.len() { SCREEN_LAST } else { 0 };
    out.clear();
    out.extend_from_slice(&[seq, first | last]);
    out.extend_from_slice(&update[start..end]);
    true
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

    /// What a browser does with the updates (`device/sdk/link`), for the tests.
    fn apply(screen: &mut Vec<u8>, update: &[u8]) -> Result<(), &'static str> {
        let u16_at = |at: usize| usize::from(u16::from_le_bytes([update[at], update[at + 1]]));
        let (kind, width, height, top, rows) = (update[0], u16_at(1), u16_at(3), u16_at(5), u16_at(7));
        let stride = width.div_ceil(8);
        if kind == SCREEN_KEY {
            *screen = vec![0; stride * height];
        }
        if screen.len() != stride * height || top + rows > height {
            return Err("not this screen");
        }
        let mut band = Vec::new();
        let mut at = SCREEN_HEADER;
        while at < update.len() {
            let head = update[at];
            if head < 0x80 {
                let n = usize::from(head) + 1;
                band.extend_from_slice(update.get(at + 1..at + 1 + n).ok_or("short")?);
                at += 1 + n;
            } else {
                let value = update[at + 1];
                let mut count = usize::from(head & 0x7F) + 3;
                at += 2;
                if head == 0xFF {
                    let mut shift = 0;
                    loop {
                        let next = update[at];
                        count += usize::from(next & 0x7F) << shift;
                        shift += 7;
                        at += 1;
                        if next < 0x80 {
                            break;
                        }
                    }
                }
                band.resize(band.len() + count, value);
            }
        }
        if band.len() != rows * stride {
            return Err("band size");
        }
        let start = top * stride;
        for (i, byte) in band.into_iter().enumerate() {
            let at = start + i;
            screen[at] = match kind {
                SCREEN_XOR => screen[at] ^ byte,
                _ => byte ^ if at >= stride { screen[at - stride] } else { 0 },
            };
        }
        let crc = u32::from_le_bytes(update[9..13].try_into().unwrap());
        if crc32(screen) != crc {
            return Err("crc");
        }
        Ok(())
    }

    /// An 800 x 480 UI-like screen: a status bar, boxes, text-like noise, a dithered area.
    fn screen(seed: u32, text_rows: core::ops::Range<usize>) -> Vec<u8> {
        let mut bits = vec![0u8; 48_000];
        let mut state = seed;
        let mut next = || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state >> 24) as u8
        };
        bits[..56 * 100].iter_mut().skip(100).step_by(7).for_each(|b| *b = 0x3C);
        for y in 100..140 {
            bits[y * 100 + 10..y * 100 + 40].fill(0xFF);
        }
        for y in text_rows {
            for x in (12..88).step_by(3) {
                bits[y * 100 + x] = next() & next();
            }
        }
        for y in 400..470 {
            bits[y * 100 + 50..y * 100 + 90].fill(if y % 2 == 0 { 0xAA } else { 0x55 });
        }
        bits
    }

    #[test]
    fn a_whole_screen_has_a_fixed_layout() {
        // 32 x 3: blank, a bar ending in one pixel, the same again. The same bytes as the SDK's test.
        let frame = [0, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0x01, 0xFF, 0xFF, 0xFF, 0x01];
        let update = screen_update(None, &frame, 32, 3).unwrap();
        let mut expected = vec![0x01, 32, 0, 3, 0, 0, 0, 3, 0];
        expected.extend_from_slice(&crc32(&frame).to_le_bytes());
        // Up-filtered: 00 00 00 00 | FF FF FF 01 | 00 00 00 00.
        expected.extend_from_slice(&[0x81, 0x00, 0x80, 0xFF, 0x00, 0x01, 0x81, 0x00]);
        assert_eq!(update, expected);
        assert_eq!(crc32(&frame), 0x92B2_F73D, "the SDK's test checks the same CRC");
        let mut shown = Vec::new();
        apply(&mut shown, &update).unwrap();
        assert_eq!(shown, frame);
    }

    #[test]
    fn screen_updates_rebuild_every_screen_from_the_first() {
        let blank = vec![0u8; 48_000];
        let key = screen_update(None, &blank, 800, 480).unwrap();
        assert_eq!(key.len(), SCREEN_HEADER + 5, "48 000 zeros are one long run");

        let main = screen(1, 160..380);
        let clock = {
            let mut bits = main.clone();
            bits[20 * 100 + 46..20 * 100 + 50].copy_from_slice(&[0x18, 0x24, 0x42, 0x81]);
            bits
        };
        let other = screen(2, 150..420);
        let mut shown = Vec::new();
        let mut before: Option<&[u8]> = None;
        for after in [&blank, &main, &clock, &other, &main] {
            let update = screen_update(before, after, 800, 480).unwrap();
            apply(&mut shown, &update).unwrap();
            assert_eq!(&shown, after);
            before = Some(after);
        }
        assert_eq!(screen_update(Some(&main), &main, 800, 480), None, "nothing changed");
        let tick = screen_update(Some(&main), &clock, 800, 480).unwrap();
        assert_eq!(tick[0], SCREEN_XOR, "a few bits in a row are smaller XORed");
        assert_eq!(&tick[5..9], &[20, 0, 1, 0], "only the changed row");
        assert!(tick.len() < 40, "{}", tick.len());

        // On another base, the CRC tells.
        let mut elsewhere = other.clone();
        assert_eq!(apply(&mut elsewhere, &tick), Err("crc"));
    }

    #[test]
    fn screen_requests_are_read_and_checked() {
        assert_eq!(ScreenRequest::parse(&[0x01]), Ok(ScreenRequest::Whole));
        assert_eq!(ScreenRequest::parse(&[0x02, 199, 0]), Ok(ScreenRequest::Tap { x: 199, y: 0 }));
        assert_eq!(ScreenRequest::parse(&[0x02, 200, 5]), Err(LinkError::Invalid("tap")));
        assert_eq!(ScreenRequest::parse(&[0x02, 1]), Err(LinkError::Malformed));
        assert_eq!(ScreenRequest::parse(&[]), Err(LinkError::Malformed));
    }

    fn notifications(update: &[u8], room: usize, seq: u8) -> Vec<Vec<u8>> {
        let mut all = Vec::new();
        let mut out = Vec::new();
        while screen_notification(update, room, all.len(), seq.wrapping_add(all.len() as u8), &mut out) {
            all.push(out.clone());
        }
        all
    }

    #[test]
    fn notifications_carry_an_update_in_order() {
        let update: Vec<u8> = (0..1000u32).map(|i| i as u8).collect();
        let parts = notifications(&update, 100, 250);
        assert_eq!(parts.len(), 11);
        assert!(parts.iter().all(|n| n.len() <= 100));
        assert_eq!(parts.iter().map(|n| n[0]).collect::<Vec<_>>(), vec![250, 251, 252, 253, 254, 255, 0, 1, 2, 3, 4]);
        assert_eq!((parts[0][1], parts[5][1], parts[10][1]), (SCREEN_FIRST, 0, SCREEN_LAST));
        let joined: Vec<u8> = parts.iter().flat_map(|n| n[2..].to_vec()).collect();
        assert_eq!(joined, update);
        assert_eq!(notifications(&update[..10], 514, 7), vec![[&[7, SCREEN_FIRST | SCREEN_LAST][..], &update[..10]].concat()]);
        assert_eq!(notifications(&update[..98], 100, 0).len(), 1, "exactly one part");
    }
}
