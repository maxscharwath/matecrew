//! The take flow as a state machine without clock or hardware. A runtime (the
//! firmware, or the virtual device in device/web) feeds it events with the
//! time, and carries out the effects it returns.
//!
//! Key → "put your badge" → badge → whose it is, ten seconds to cancel → the
//! take is queued and the main screen comes back.

use crate::{
    contract::{DeviceState, Side, Take},
    time,
};
use serde::{Deserialize, Serialize};

/// How long the terminal waits for a badge after a key press.
pub const BADGE_WAIT_MS: u64 = 15_000;
/// Seconds to cancel a take before it counts.
pub const UNDO_SECONDS: u32 = 10;
/// How long a message (unknown badge, not ready) stays before the main screen returns.
pub const MESSAGE_MS: u64 = 5_000;

/// In JSON: `{"type":"key","side":"left"}`, `{"type":"badge","uid":"04A1…"}`, `{"type":"tick"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    Key { side: Side },
    /// A badge UID, as `normalize_uid` gives it.
    Badge { uid: String },
    /// Nothing happened: lets a deadline pass. Send one at `Flow::deadline`.
    Tick,
}

/// What the runtime knows when an event arrives.
#[derive(Clone, Copy)]
pub struct Context<'a> {
    /// Monotonic milliseconds, for timeouts.
    pub now_ms: u64,
    /// Seconds since 1970, once a sync has set the clock.
    pub unix: Option<i64>,
    /// From the last sync. Without it, badges cannot be told apart.
    pub state: Option<&'a DeviceState>,
    /// Fresh random bits for a take id.
    pub random: u64,
}

/// In JSON: `{"type":"take","name":"Alex","keyLabel":"Prendre · Maté","seconds":10}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Screen {
    /// The site's screen. After a queued take, the runtime fetches it again.
    Main,
    Badge { key_label: String },
    Take { name: String, key_label: String, seconds: u32 },
    UnknownBadge { uid: String },
    /// No state or no clock yet: the first sync has not happened.
    NotReady,
}

/// In JSON: `"key"`, `"accepted"`, `"error"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Beep {
    Key,
    Accepted,
    Error,
}

/// In JSON: `{"type":"show","screen":{…}}`, `{"type":"beep","beep":"key"}`,
/// `{"type":"queue","take":{…}}`, `{"type":"noteUnknownBadge","uid":"04A1…"}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Effect {
    Show { screen: Screen },
    Beep { beep: Beep },
    /// Keep the take until the site acknowledges it.
    Queue { take: Take },
    /// Report this badge to the site with the next status.
    NoteUnknownBadge { uid: String },
}

#[derive(Debug, Default)]
pub struct Flow {
    stage: Stage,
}

#[derive(Debug, Default)]
enum Stage {
    #[default]
    Idle,
    AwaitBadge { side: Side, until: u64 },
    Confirm { take: Take, until: u64 },
    Message { until: u64 },
}

impl Flow {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_idle(&self) -> bool {
        matches!(self.stage, Stage::Idle)
    }

    /// The runtime should poll the NFC reader.
    pub fn wants_badge(&self) -> bool {
        matches!(self.stage, Stage::AwaitBadge { .. })
    }

    /// When to send a `Tick` at the latest, in `now_ms` time.
    pub fn deadline(&self) -> Option<u64> {
        match self.stage {
            Stage::Idle => None,
            Stage::AwaitBadge { until, .. } | Stage::Confirm { until, .. } | Stage::Message { until } => Some(until),
        }
    }

    pub fn handle(&mut self, event: Event, cx: Context) -> Vec<Effect> {
        let expired = self.deadline().is_some_and(|until| cx.now_ms >= until);
        match (std::mem::take(&mut self.stage), event) {
            (Stage::Idle | Stage::Message { .. }, Event::Key { side }) => self.ask_for_badge(side, cx),
            (Stage::Message { .. }, Event::Tick) if expired => vec![Effect::Show { screen: Screen::Main }],

            (Stage::AwaitBadge { side, .. }, Event::Badge { uid }) => self.read_badge(side, uid, cx),
            (Stage::AwaitBadge { .. }, Event::Key { .. }) => vec![Effect::Beep { beep: Beep::Key }, Effect::Show { screen: Screen::Main }],
            (Stage::AwaitBadge { .. }, Event::Tick) if expired => vec![Effect::Show { screen: Screen::Main }],

            (Stage::Confirm { take, .. }, Event::Key { side: Side::Left }) => vec![Effect::Queue { take }, Effect::Show { screen: Screen::Main }],
            (Stage::Confirm { take, .. }, Event::Tick) if expired => vec![Effect::Queue { take }, Effect::Show { screen: Screen::Main }],
            (Stage::Confirm { .. }, Event::Key { side: Side::Right }) => vec![Effect::Beep { beep: Beep::Key }, Effect::Show { screen: Screen::Main }],

            // A badge with no key touched first, or a tick before its deadline.
            (stage, _) => {
                self.stage = stage;
                Vec::new()
            }
        }
    }

    fn ask_for_badge(&mut self, side: Side, cx: Context) -> Vec<Effect> {
        let Some(state) = cx.state.filter(|_| cx.unix.is_some()) else {
            self.stage = Stage::Message { until: cx.now_ms + MESSAGE_MS };
            return vec![Effect::Beep { beep: Beep::Error }, Effect::Show { screen: Screen::NotReady }];
        };
        self.stage = Stage::AwaitBadge { side, until: cx.now_ms + BADGE_WAIT_MS };
        vec![
            Effect::Beep { beep: Beep::Key },
            Effect::Show { screen: Screen::Badge { key_label: state.key(side).label.clone() } },
        ]
    }

    fn read_badge(&mut self, side: Side, uid: String, cx: Context) -> Vec<Effect> {
        // ask_for_badge only gets here with both.
        let (Some(state), Some(unix)) = (cx.state, cx.unix) else {
            return vec![Effect::Show { screen: Screen::Main }];
        };
        let key = state.key(side);
        let Some(name) = state.badge_holder(&uid) else {
            self.stage = Stage::Message { until: cx.now_ms + MESSAGE_MS };
            return vec![
                Effect::Beep { beep: Beep::Error },
                Effect::NoteUnknownBadge { uid: uid.clone() },
                Effect::Show { screen: Screen::UnknownBadge { uid } },
            ];
        };
        let screen = Screen::Take { name: name.to_owned(), key_label: key.label.clone(), seconds: UNDO_SECONDS };
        let take = Take {
            id: format!("{:016x}", cx.random),
            badge_uid: uid,
            action: key.action,
            item_id: key.item_id.clone(),
            at: time::format_iso(unix),
        };
        self.stage = Stage::Confirm { take, until: cx.now_ms + u64::from(UNDO_SECONDS) * 1_000 };
        vec![Effect::Beep { beep: Beep::Accepted }, Effect::Show { screen }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{Action, Badge, Item, Key, Keys, Named, Office};

    fn state() -> DeviceState {
        let key = |action, label: &str| Key { action, item_id: Some("i1".into()), label: label.into() };
        DeviceState {
            device: Named { id: "d1".into(), name: "Terminal".into() },
            office: Office { name: "Lausanne".into(), timezone: "Europe/Zurich".into(), locale: "fr".into() },
            keys: Keys { left: key(Action::Take, "Prendre · Maté"), right: key(Action::Return, "Rendre · Maté") },
            items: vec![Item { id: "i1".into(), name: "Maté".into(), stock: 36 }],
            badges: vec![Badge { uid: "04A1B2C3D4E5F6".into(), name: "Alex".into() }],
            sync_times: vec![],
            server_time: "2026-10-09T18:25:00Z".into(),
        }
    }

    fn cx(state: &DeviceState, now_ms: u64) -> Context<'_> {
        Context { now_ms, unix: Some(1_791_570_300), state: Some(state), random: 0xabc }
    }

    fn badge(uid: &str) -> Event {
        Event::Badge { uid: uid.into() }
    }

    #[test]
    fn a_key_then_a_known_badge_queues_a_take_after_the_undo_window() {
        let s = state();
        let mut flow = Flow::default();
        assert_eq!(
            flow.handle(Event::Key { side: Side::Left }, cx(&s, 0)),
            [Effect::Beep { beep: Beep::Key }, Effect::Show { screen: Screen::Badge { key_label: "Prendre · Maté".into() } }]
        );
        assert!(flow.wants_badge());
        assert_eq!(
            flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 2_000)),
            [
                Effect::Beep { beep: Beep::Accepted },
                Effect::Show { screen: Screen::Take { name: "Alex".into(), key_label: "Prendre · Maté".into(), seconds: 10 } },
            ]
        );
        assert_eq!(flow.deadline(), Some(12_000));
        assert_eq!(flow.handle(Event::Tick, cx(&s, 11_999)), []);
        let effects = flow.handle(Event::Tick, cx(&s, 12_000));
        assert_eq!(
            effects,
            [
                Effect::Queue { take: Take {
                    id: "0000000000000abc".into(),
                    badge_uid: "04A1B2C3D4E5F6".into(),
                    action: Action::Take,
                    item_id: Some("i1".into()),
                    at: "2026-10-09T18:25:00Z".into(),
                } },
                Effect::Show { screen: Screen::Main },
            ]
        );
        assert!(flow.is_idle());
    }

    #[test]
    fn the_left_key_confirms_at_once_and_the_right_one_cancels() {
        let s = state();
        let mut flow = Flow::default();
        flow.handle(Event::Key { side: Side::Right }, cx(&s, 0));
        flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 1_000));
        let effects = flow.handle(Event::Key { side: Side::Left }, cx(&s, 2_000));
        assert!(matches!(&effects[0], Effect::Queue { take } if take.action == Action::Return));

        flow.handle(Event::Key { side: Side::Left }, cx(&s, 3_000));
        flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 4_000));
        assert_eq!(
            flow.handle(Event::Key { side: Side::Right }, cx(&s, 5_000)),
            [Effect::Beep { beep: Beep::Key }, Effect::Show { screen: Screen::Main }]
        );
        assert!(flow.is_idle());
    }

    #[test]
    fn an_unknown_badge_is_reported_and_nothing_is_queued() {
        let s = state();
        let mut flow = Flow::default();
        flow.handle(Event::Key { side: Side::Left }, cx(&s, 0));
        assert_eq!(
            flow.handle(badge("04FFFFFFFFFFFF"), cx(&s, 1_000)),
            [
                Effect::Beep { beep: Beep::Error },
                Effect::NoteUnknownBadge { uid: "04FFFFFFFFFFFF".into() },
                Effect::Show { screen: Screen::UnknownBadge { uid: "04FFFFFFFFFFFF".into() } },
            ]
        );
        assert_eq!(flow.handle(Event::Tick, cx(&s, 6_000)), [Effect::Show { screen: Screen::Main }]);
    }

    #[test]
    fn waiting_for_a_badge_ends_with_a_key_or_the_timeout() {
        let s = state();
        let mut flow = Flow::default();
        flow.handle(Event::Key { side: Side::Left }, cx(&s, 0));
        assert_eq!(flow.handle(Event::Key { side: Side::Right }, cx(&s, 1_000)), [Effect::Beep { beep: Beep::Key }, Effect::Show { screen: Screen::Main }]);

        flow.handle(Event::Key { side: Side::Left }, cx(&s, 2_000));
        assert_eq!(flow.handle(Event::Tick, cx(&s, 2_000 + BADGE_WAIT_MS)), [Effect::Show { screen: Screen::Main }]);
        assert!(flow.is_idle());
    }

    #[test]
    fn a_badge_without_a_key_is_ignored() {
        let s = state();
        let mut flow = Flow::default();
        assert_eq!(flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 0)), []);
        assert!(flow.is_idle());
    }

    #[test]
    fn speaks_json_to_the_virtual_device() {
        let event: Event = serde_json::from_str(r#"{"type":"key","side":"left"}"#).unwrap();
        assert_eq!(event, Event::Key { side: Side::Left });
        assert_eq!(serde_json::from_str::<Event>(r#"{"type":"tick"}"#).unwrap(), Event::Tick);
        let effects = [
            Effect::Beep { beep: Beep::Accepted },
            Effect::Show { screen: Screen::Take { name: "Alex".into(), key_label: "Prendre".into(), seconds: 10 } },
            Effect::Show { screen: Screen::Main },
        ];
        assert_eq!(
            serde_json::to_string(&effects).unwrap(),
            r#"[{"type":"beep","beep":"accepted"},{"type":"show","screen":{"type":"take","name":"Alex","keyLabel":"Prendre","seconds":10}},{"type":"show","screen":{"type":"main"}}]"#
        );
    }

    #[test]
    fn before_the_first_sync_it_says_so() {
        let s = state();
        let mut flow = Flow::default();
        let no_clock = Context { unix: None, ..cx(&s, 0) };
        assert_eq!(
            flow.handle(Event::Key { side: Side::Left }, no_clock),
            [Effect::Beep { beep: Beep::Error }, Effect::Show { screen: Screen::NotReady }]
        );
        // A key during the message starts over, now that the sync has happened.
        assert!(matches!(flow.handle(Event::Key { side: Side::Left }, cx(&s, 1_000))[1], Effect::Show { screen: Screen::Badge { .. } }));
    }
}
