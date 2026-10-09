//! Shapes of the site's device API, mirroring src/lib/device/contract.ts.
//! Change both together.

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct LinkStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Deserialize)]
pub struct LinkGranted {
    pub access_token: String,
    pub device_name: String,
    pub office_name: String,
}

#[derive(Deserialize)]
pub struct LinkError {
    pub error: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum Action {
    Take,
    Return,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Key {
    pub action: Action,
    pub item_id: Option<String>,
    /// "Prendre · Maté", or what an admin wrote instead.
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Keys {
    pub left: Key,
    pub right: Key,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Named {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Office {
    pub name: String,
    pub timezone: String,
    pub locale: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub stock: i64,
    /// 24 x 24 pixels, packed 1-bit (1 = ink), base64. See [`ITEM_IMAGE_SIZE`].
    #[serde(default)]
    pub image: String,
}

/// Side of an item's picture, in pixels of the 200 x 120 canvas.
pub const ITEM_IMAGE_SIZE: u32 = 24;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Badge {
    pub uid: String,
    pub name: String,
    /// What the holder drank today, this week and this month, as of the last sync.
    #[serde(default)]
    pub today: u32,
    #[serde(default)]
    pub week: u32,
    #[serde(default)]
    pub month: u32,
}

/// What the terminal needs to work until the next sync. It keeps a copy in
/// NVS, so a badge still works when the Wi-Fi is down.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceState {
    pub device: Named,
    pub office: Office,
    pub keys: Keys,
    pub items: Vec<Item>,
    /// Assigned badges only: an UID missing here is unknown.
    pub badges: Vec<Badge>,
    pub sync_times: Vec<String>,
    pub server_time: String,
    /// The latest firmware published on the site; the terminal installs it when it is newer.
    #[serde(default)]
    pub firmware: Option<FirmwareRelease>,
}

/// A firmware image on the site, downloaded with the device's token.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct FirmwareRelease {
    /// As in device/firmware/Cargo.toml: "0.2.0".
    pub version: String,
    /// Path on the site: "/api/device/firmware/0.2.0".
    pub url: String,
    /// Hex SHA-256 of the image.
    pub sha256: String,
    pub size: u64,
}

/// Whether `candidate` ("0.10.0") comes after `current` ("0.9.3"), comparing
/// numbers; anything that is not a version never does.
pub fn is_newer_version(candidate: &str, current: &str) -> bool {
    let parse = |v: &str| v.split('.').map(|n| n.parse::<u64>().ok()).collect::<Option<Vec<_>>>();
    matches!((parse(candidate), parse(current)), (Some(a), Some(b)) if a > b)
}

impl DeviceState {
    pub fn key(&self, side: Side) -> &Key {
        match side {
            Side::Left => &self.keys.left,
            Side::Right => &self.keys.right,
        }
    }

    /// The badge with this UID, if it is assigned; `uid` as `normalize_uid` gives it.
    pub fn badge(&self, uid: &str) -> Option<&Badge> {
        self.badges.iter().find(|b| normalize_uid(&b.uid).as_deref() == Some(uid))
    }

    /// Name of the person the badge belongs to.
    pub fn badge_holder(&self, uid: &str) -> Option<&str> {
        self.badge(uid).map(|b| b.name.as_str())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Take {
    /// Given by the terminal; the site ignores a take it already has.
    pub id: String,
    pub badge_uid: String,
    pub action: Action,
    pub item_id: Option<String>,
    /// When the badge was read, ISO 8601 in UTC.
    pub at: String,
}

#[derive(Serialize)]
pub struct TakesRequest<'a> {
    pub takes: &'a [Take],
}

#[derive(Deserialize)]
pub struct TakesResponse {
    /// Every id the site is done with, applied or rejected.
    pub done: Vec<String>,
    pub rejected: Vec<Rejected>,
}

#[derive(Deserialize)]
pub struct Rejected {
    pub id: String,
    pub reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport<'a> {
    pub firmware_version: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub battery_mv: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wifi_rssi: Option<i8>,
    pub unknown_badges: &'a [String],
}

/// What an admin does to the terminal from the site's console. Keys and
/// badges go through the same path as real ones.
#[derive(Deserialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Command {
    Key { id: String, side: Side },
    /// Already normalized by the site.
    Badge { id: String, uid: String },
    Sync { id: String },
    Restart { id: String },
    /// Forget the Wi-Fi and start setup again; the token stays.
    ForgetWifi { id: String },
    /// A kind this firmware does not know yet.
    #[serde(other)]
    Unknown,
}

/// `GET /api/device/commands?wait=0..25`, held until a command arrives.
#[derive(Deserialize)]
pub struct CommandsResponse {
    pub commands: Vec<Command>,
    /// Someone has the console open: worth staying awake and polling again.
    pub live: bool,
}

/// Uppercase hex without separators, 4 to 10 bytes, like `normalizeBadgeUid` on the site.
pub fn normalize_uid(input: &str) -> Option<String> {
    let uid: String = input
        .chars()
        .filter(char::is_ascii_hexdigit)
        .map(|c| c.to_ascii_uppercase())
        .collect();
    (uid.len() >= 8 && uid.len() <= 20 && uid.len() % 2 == 0).then_some(uid)
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATE: &str = r#"{
        "device": { "id": "d1", "name": "Terminal" },
        "office": { "name": "Lausanne", "timezone": "Europe/Zurich", "locale": "fr" },
        "keys": {
            "left": { "action": "TAKE", "itemId": "i1", "label": "Prendre · Maté" },
            "right": { "action": "RETURN", "itemId": "i1", "label": "Rendre · Maté" }
        },
        "items": [{ "id": "i1", "name": "Maté", "stock": 36 }],
        "badges": [{ "uid": "04a1b2c3d4e5f6", "name": "Alex" }],
        "syncTimes": ["08:00", "12:00"],
        "serverTime": "2026-10-09T18:25:00.000Z"
    }"#;

    #[test]
    fn reads_the_state_the_site_sends() {
        let state: DeviceState = serde_json::from_str(STATE).unwrap();
        assert_eq!(state.key(Side::Right).action, Action::Return);
        assert_eq!(state.key(Side::Left).item_id.as_deref(), Some("i1"));
        assert_eq!(state.badge_holder("04A1B2C3D4E5F6"), Some("Alex"));
        assert_eq!(state.badge_holder("04A1B2C3D4E5F7"), None);
    }

    #[test]
    fn writes_takes_in_camel_case() {
        let take = Take {
            id: "t1".into(),
            badge_uid: "04A1B2C3".into(),
            action: Action::Take,
            item_id: None,
            at: "2026-10-09T18:25:00Z".into(),
        };
        let json = serde_json::to_string(&TakesRequest { takes: &[take] }).unwrap();
        assert_eq!(
            json,
            r#"{"takes":[{"id":"t1","badgeUid":"04A1B2C3","action":"TAKE","itemId":null,"at":"2026-10-09T18:25:00Z"}]}"#
        );
    }

    #[test]
    fn leaves_unknown_status_fields_out() {
        let json = serde_json::to_string(&StatusReport {
            firmware_version: "0.1.0",
            battery_mv: None,
            wifi_rssi: Some(-61),
            unknown_badges: &[],
        })
        .unwrap();
        assert_eq!(json, r#"{"firmwareVersion":"0.1.0","wifiRssi":-61,"unknownBadges":[]}"#);
    }

    #[test]
    fn reads_console_commands() {
        let reply: CommandsResponse = serde_json::from_str(
            r#"{"live":true,"commands":[
                {"id":"c1","kind":"key","side":"left"},
                {"id":"c2","kind":"badge","uid":"04A1B2C3"},
                {"id":"c3","kind":"forgetWifi"},
                {"id":"c4","kind":"selfDestruct"}
            ]}"#,
        )
        .unwrap();
        assert!(reply.live);
        assert_eq!(
            reply.commands,
            [
                Command::Key { id: "c1".into(), side: Side::Left },
                Command::Badge { id: "c2".into(), uid: "04A1B2C3".into() },
                Command::ForgetWifi { id: "c3".into() },
                Command::Unknown,
            ]
        );
    }

    #[test]
    fn normalizes_uids_like_the_site() {
        assert_eq!(normalize_uid("04:a1:b2:c3").as_deref(), Some("04A1B2C3"));
        assert_eq!(normalize_uid("04a1b2"), None);
        assert_eq!(normalize_uid("04a1b2c3d"), None);
    }
}

/// Decodes standard base64 (with or without padding), as the site sends item pictures.
pub fn decode_base64(input: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for c in input.bytes().filter(|&c| c != b'=') {
        buffer = (buffer << 6) | u32::from(value(c)?);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod version_tests {
    use super::is_newer_version;

    #[test]
    fn compares_numbers_not_text() {
        assert!(is_newer_version("0.2.0", "0.1.0"));
        assert!(is_newer_version("0.10.0", "0.9.3"));
        assert!(is_newer_version("1.0", "0.9.9"));
        assert!(!is_newer_version("0.1.0", "0.1.0"));
        assert!(!is_newer_version("0.1.0", "0.2.0"));
        assert!(!is_newer_version("next", "0.1.0"));
    }
}

#[cfg(test)]
mod base64_tests {
    use super::decode_base64;

    #[test]
    fn decodes() {
        assert_eq!(decode_base64("TWFu").unwrap(), b"Man");
        assert_eq!(decode_base64("TWE=").unwrap(), b"Ma");
        assert_eq!(decode_base64("/w==").unwrap(), [0xff]);
        assert_eq!(decode_base64("@@"), None);
    }
}
