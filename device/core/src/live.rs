//! The terminal's live channel: one WebSocket to its relay (realtime/ on the site's side,
//! `realtime/src/protocol.ts` there), instead of polling the site. Commands from the console
//! arrive at once, the screen goes to the console as the rows that changed, and the site says
//! when what the terminal shows changed, so it syncs then rather than on a timer.
//!
//! Text frames are JSON with a `t` tag; the screen goes as binary frames
//! (`[y u16 LE][rows u16 LE][rows × ROW_BYTES]`). The heartbeat is the text `PING`, answered
//! `PONG` by the relay without waking it.

use serde::{Deserialize, Serialize};

use crate::contract::Command;

pub const PING: &str = "p";
pub const PONG: &str = "o";
/// How often the terminal pings; the relay counts it gone after 45 s of silence.
pub const PING_EVERY_MS: u64 = 30_000;
/// A ping unanswered this long: the connection is dead (Wi-Fi lost, NAT dropped it).
pub const PONG_WITHIN_MS: u64 = 10_000;
/// The subprotocol the relay answers with.
pub const SUBPROTOCOL: &str = "matecrew";

pub const PANEL_WIDTH: usize = 800;
pub const PANEL_HEIGHT: usize = 480;
pub const ROW_BYTES: usize = PANEL_WIDTH / 8;
pub const FRAME_BYTES: usize = ROW_BYTES * PANEL_HEIGHT;
const HEADER: usize = 4;

/// What the relay sends the terminal.
#[derive(Deserialize, Debug, PartialEq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum ToTerminal {
    Command { command: Command },
    /// Whether a console wants the screen: patches go only then.
    Live { watching: bool },
    /// What the terminal shows changed on the site at `at` (ms since 1970).
    Sync { at: f64 },
    #[serde(other)]
    Unknown,
}

/// What the terminal says about itself; the relay merges each report into the last one.
#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub firmware: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub battery_mv: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rssi: Option<i8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    /// Free internal heap, bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heap: Option<u32>,
    /// Seconds since it started.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime: Option<u64>,
    /// Its last sync with the site, ms since 1970.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synced_at: Option<i64>,
}

/// What the terminal sends the relay.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum FromTerminal<'a> {
    Hello { status: &'a Status },
    Status { status: &'a Status },
    /// The command `id` arrived; the console marks it delivered.
    Ack { id: &'a str },
    Log { line: &'a str },
}

impl FromTerminal<'_> {
    pub fn json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

/// The relay's message, or `Unknown` for anything this firmware does not read.
pub fn parse(text: &str) -> ToTerminal {
    serde_json::from_str(text).unwrap_or(ToTerminal::Unknown)
}

/// Whether a "what you show changed" at `at` (ms) is news to a terminal whose state the site
/// built at `server_time` (seconds, `contract::DeviceState::server_time`): not when it synced since.
pub fn is_news(at_ms: f64, server_time: Option<i64>) -> bool {
    match server_time {
        Some(seconds) => at_ms > (seconds * 1000) as f64,
        None => true,
    }
}

/// "wss://relay.example.com/terminals/socket" → (TLS, host, port, path); None for anything else.
pub fn split_url(url: &str) -> Option<(bool, String, u16, String)> {
    let (tls, rest) = match url.split_once("://")? {
        ("wss", rest) => (true, rest),
        ("ws", rest) => (false, rest),
        _ => return None,
    };
    let (authority, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) => (host, port.parse().ok()?),
        None => (authority, if tls { 443 } else { 80 }),
    };
    if host.is_empty() {
        return None;
    }
    let path = if path.is_empty() { "/" } else { path };
    Some((tls, host.to_owned(), port, path.to_owned()))
}

/// The id of a command, for its acknowledgment.
pub fn command_id(command: &Command) -> Option<&str> {
    match command {
        Command::Key { id, .. }
        | Command::Both { id }
        | Command::Badge { id, .. }
        | Command::Sync { id, .. }
        | Command::Tap { id, .. }
        | Command::Restart { id }
        | Command::ForgetWifi { id } => Some(id),
        Command::Unknown => None,
    }
}

/// The rows of `after` that differ from `before`, as `(first row, rows)`; all of them without a
/// `before`, none when the frames are the same.
pub fn changed_rows(before: Option<&[u8]>, after: &[u8]) -> Option<(usize, usize)> {
    let Some(before) = before.filter(|b| b.len() == after.len()) else {
        return Some((0, after.len() / ROW_BYTES));
    };
    let differs = |row: &usize| before[row * ROW_BYTES..(row + 1) * ROW_BYTES] != after[row * ROW_BYTES..(row + 1) * ROW_BYTES];
    let rows = after.len() / ROW_BYTES;
    let first = (0..rows).find(differs)?;
    let last = (first..rows).rev().find(differs)?;
    Some((first, last - first + 1))
}

/// The binary frame for rows `y..y + rows` of `frame`.
pub fn patch(frame: &[u8], y: usize, rows: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER + rows * ROW_BYTES);
    out.extend_from_slice(&(y as u16).to_le_bytes());
    out.extend_from_slice(&(rows as u16).to_le_bytes());
    out.extend_from_slice(&frame[y * ROW_BYTES..(y + rows) * ROW_BYTES]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::Side;

    #[test]
    fn relay_messages_parse_and_unknown_ones_are_ignored() {
        assert_eq!(
            parse(r#"{"t":"command","command":{"id":"c1","kind":"key","side":"left"}}"#),
            ToTerminal::Command { command: Command::Key { id: "c1".into(), side: Side::Left } }
        );
        assert_eq!(parse(r#"{"t":"live","watching":true}"#), ToTerminal::Live { watching: true });
        assert_eq!(parse(r#"{"t":"sync","at":1760000000123}"#), ToTerminal::Sync { at: 1_760_000_000_123.0 });
        assert_eq!(parse(r#"{"t":"later","x":1}"#), ToTerminal::Unknown);
        assert_eq!(parse("not json"), ToTerminal::Unknown);
    }

    #[test]
    fn terminal_messages_have_the_relay_s_shape() {
        let status = Status { firmware: Some("0.4.0".into()), battery_mv: Some(3900), rssi: Some(-61), ..Status::default() };
        assert_eq!(
            FromTerminal::Hello { status: &status }.json(),
            r#"{"t":"hello","status":{"firmware":"0.4.0","batteryMv":3900,"rssi":-61}}"#
        );
        assert_eq!(FromTerminal::Ack { id: "c1" }.json(), r#"{"t":"ack","id":"c1"}"#);
    }

    #[test]
    fn a_change_is_news_only_after_the_last_state() {
        assert!(is_news(1_000_500.0, None));
        assert!(is_news(1_000_500.0, Some(999)));
        assert!(!is_news(1_000_500.0, Some(1_001)));
    }

    #[test]
    fn relay_addresses_split() {
        assert_eq!(
            split_url("wss://relay.example.dev/terminals/socket"),
            Some((true, "relay.example.dev".into(), 443, "/terminals/socket".into()))
        );
        assert_eq!(split_url("ws://10.0.0.2:8788/t"), Some((false, "10.0.0.2".into(), 8788, "/t".into())));
        assert_eq!(split_url("wss://relay.example.dev"), Some((true, "relay.example.dev".into(), 443, "/".into())));
        assert_eq!(split_url("https://x"), None);
        assert_eq!(split_url("wss://:443/x"), None);
    }

    #[test]
    fn only_the_rows_that_changed_go() {
        let before = vec![0u8; FRAME_BYTES];
        let mut after = before.clone();
        assert_eq!(changed_rows(Some(&before), &after), None);
        assert_eq!(changed_rows(None, &after), Some((0, PANEL_HEIGHT)));
        after[10 * ROW_BYTES + 3] = 0xff;
        after[12 * ROW_BYTES] = 0x01;
        assert_eq!(changed_rows(Some(&before), &after), Some((10, 3)));
        let frame = patch(&after, 10, 3);
        assert_eq!(&frame[..4], &[10, 0, 3, 0]);
        assert_eq!(frame.len(), 4 + 3 * ROW_BYTES);
        assert_eq!(frame[4 + 3], 0xff);
    }
}
