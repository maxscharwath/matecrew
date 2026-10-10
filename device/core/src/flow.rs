//! The terminal's flow as a state machine without clock or hardware. A runtime
//! (the firmware, or the virtual device in device/web) feeds it events with
//! the time, and carries out the effects it returns.
//!
//! Left key → "put your badge" → badge → the items one by one: the left key
//! shows the next one, the right key takes it. After the last item comes a
//! card to leave without taking anything.
//! Right key → "put your badge" → badge → what the person drank today, this
//! week and this month.

use crate::{
    claim::Claim,
    contract::{Action, DeviceState, Side, Take},
    time,
};
use serde::{Deserialize, Serialize};

/// How long the terminal waits for a badge after a key press.
pub const BADGE_WAIT_MS: u64 = 15_000;
/// How long the item picker stays without a key press.
pub const PICK_MS: u64 = 20_000;
/// How long a message (taken, unknown badge, not ready) stays before the main screen returns.
pub const MESSAGE_MS: u64 = 5_000;
/// How long the consumption summary stays.
pub const SUMMARY_MS: u64 = 10_000;
/// How long an unknown badge's claim QR stays.
pub const CLAIM_MS: u64 = 30_000;

/// In JSON: `{"type":"key","side":"left"}`, `{"type":"badge","uid":"04A1…"}`, `{"type":"tick"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    Key {
        side: Side,
    },
    /// A badge UID, as `normalize_uid` gives it.
    Badge {
        uid: String,
    },
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
    /// To sign the link that claims an unknown badge; None shows only the UID.
    pub claim: Option<Claim<'a>>,
}

/// In JSON: `{"type":"pick","name":"Alex","item":"Maté Zero","stock":12,"image":"…","index":1,"count":3}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Screen {
    /// The site's screen. After a queued take, the runtime fetches it again.
    Main,
    Badge {
        key_label: String,
    },
    /// One item to take; `image` as in `contract::Item`.
    Pick {
        name: String,
        item: String,
        stock: i64,
        image: String,
        index: u32,
        count: u32,
    },
    /// After the last item: the right key leaves without taking anything.
    Leave {
        name: String,
    },
    Taken {
        name: String,
        item: String,
        image: String,
    },
    Summary {
        name: String,
        today: u32,
        week: u32,
        month: u32,
    },
    /// `claim_url` lets the person link the badge to their account by scanning it.
    UnknownBadge {
        uid: String,
        #[serde(default)]
        claim_url: Option<String>,
    },
    /// No state or no clock yet: the first sync has not happened.
    NotReady,
    /// The office has no active item.
    NoItems,
}

/// In JSON: `"key"`, `"accepted"`, `"error"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Beep {
    Key,
    Accepted,
    Error,
    Notification,
}

/// In JSON: `{"type":"show","screen":{…}}`, `{"type":"beep","beep":"key"}`,
/// `{"type":"queue","take":{…}}`, `{"type":"noteUnknownBadge","uid":"04A1…"}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Effect {
    Show {
        screen: Screen,
    },
    Beep {
        beep: Beep,
    },
    /// Keep the take until the site acknowledges it.
    Queue {
        take: Take,
    },
    /// Report this badge to the site with the next status.
    NoteUnknownBadge {
        uid: String,
    },
}

#[derive(Debug, Default)]
pub struct Flow {
    stage: Stage,
}

#[derive(Debug, Default)]
enum Stage {
    #[default]
    Idle,
    AwaitBadge {
        side: Side,
        until: u64,
    },
    Pick {
        uid: String,
        name: String,
        index: usize,
        until: u64,
    },
    Message {
        until: u64,
    },
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
            Stage::AwaitBadge { until, .. }
            | Stage::Pick { until, .. }
            | Stage::Message { until } => Some(until),
        }
    }

    pub fn handle(&mut self, event: Event, cx: Context) -> Vec<Effect> {
        let expired = self.deadline().is_some_and(|until| cx.now_ms >= until);
        match (std::mem::take(&mut self.stage), event) {
            (Stage::Idle | Stage::Message { .. }, Event::Key { side }) => {
                self.ask_for_badge(side, cx)
            }

            (Stage::AwaitBadge { side, .. }, Event::Badge { uid }) => {
                self.read_badge(side, uid, cx)
            }
            (Stage::AwaitBadge { .. }, Event::Key { .. }) => {
                vec![beep(Beep::Key), show(Screen::Main)]
            }

            // The items, then the card to leave: one more stop than there are items.
            (
                Stage::Pick {
                    uid, name, index, ..
                },
                Event::Key { side: Side::Left },
            ) => {
                let stops = cx.state.map_or(0, |s| s.items.len()) + 1;
                self.pick(uid, name, (index + 1) % stops, cx, Beep::Key)
            }
            (Stage::Pick { index, .. }, Event::Key { side: Side::Right })
                if index >= cx.state.map_or(0, |s| s.items.len()) =>
            {
                vec![beep(Beep::Key), show(Screen::Main)]
            }
            (
                Stage::Pick {
                    uid, name, index, ..
                },
                Event::Key { side: Side::Right },
            ) => self.take(uid, name, index, cx),

            (
                Stage::AwaitBadge { .. } | Stage::Pick { .. } | Stage::Message { .. },
                Event::Tick,
            ) if expired => {
                vec![show(Screen::Main)]
            }

            // A badge with no key touched first, or a tick before its deadline.
            (stage, _) => {
                self.stage = stage;
                Vec::new()
            }
        }
    }

    fn message(&mut self, cx: Context, ms: u64) {
        self.stage = Stage::Message {
            until: cx.now_ms + ms,
        };
    }

    fn ask_for_badge(&mut self, side: Side, cx: Context) -> Vec<Effect> {
        let Some(state) = cx.state.filter(|_| cx.unix.is_some()) else {
            self.message(cx, MESSAGE_MS);
            return vec![beep(Beep::Error), show(Screen::NotReady)];
        };
        self.stage = Stage::AwaitBadge {
            side,
            until: cx.now_ms + BADGE_WAIT_MS,
        };
        vec![
            beep(Beep::Key),
            show(Screen::Badge {
                key_label: state.key(side).label.clone(),
            }),
        ]
    }

    fn read_badge(&mut self, side: Side, uid: String, cx: Context) -> Vec<Effect> {
        // ask_for_badge only gets here with a state.
        let Some(state) = cx.state else {
            return vec![show(Screen::Main)];
        };
        let Some(badge) = state.badge(&uid) else {
            // Time to find the phone and scan.
            self.message(cx, CLAIM_MS);
            let claim_url = cx
                .claim
                .zip(cx.unix)
                .map(|(claim, unix)| claim.url(&uid, unix));
            return vec![
                beep(Beep::Error),
                Effect::NoteUnknownBadge { uid: uid.clone() },
                show(Screen::UnknownBadge { uid, claim_url }),
            ];
        };
        match side {
            Side::Right => {
                self.message(cx, SUMMARY_MS);
                let screen = Screen::Summary {
                    name: badge.name.clone(),
                    today: badge.today,
                    week: badge.week,
                    month: badge.month,
                };
                vec![beep(Beep::Accepted), show(screen)]
            }
            Side::Left if state.items.is_empty() => {
                self.message(cx, MESSAGE_MS);
                vec![beep(Beep::Error), show(Screen::NoItems)]
            }
            Side::Left => self.pick(uid, badge.name.clone(), 0, cx, Beep::Accepted),
        }
    }

    fn pick(
        &mut self,
        uid: String,
        name: String,
        index: usize,
        cx: Context,
        sound: Beep,
    ) -> Vec<Effect> {
        let Some(state) = cx.state else {
            return vec![show(Screen::Main)];
        };
        let Some(item) = state.items.get(index) else {
            self.stage = Stage::Pick {
                uid,
                name: name.clone(),
                index,
                until: cx.now_ms + PICK_MS,
            };
            return vec![beep(sound), show(Screen::Leave { name })];
        };
        let screen = Screen::Pick {
            name: name.clone(),
            item: item.name.clone(),
            stock: item.stock,
            image: item.image.clone(),
            index: index as u32,
            count: cx.state.map_or(0, |s| s.items.len()) as u32,
        };
        self.stage = Stage::Pick {
            uid,
            name,
            index,
            until: cx.now_ms + PICK_MS,
        };
        vec![beep(sound), show(screen)]
    }

    fn take(&mut self, uid: String, name: String, index: usize, cx: Context) -> Vec<Effect> {
        let (Some(item), Some(unix)) = (cx.state.and_then(|s| s.items.get(index)), cx.unix) else {
            return vec![show(Screen::Main)];
        };
        let take = Take {
            id: format!("{:016x}", cx.random),
            badge_uid: uid,
            action: Action::Take,
            item_id: Some(item.id.clone()),
            at: time::format_iso(unix),
        };
        self.message(cx, MESSAGE_MS);
        vec![
            Effect::Queue { take },
            beep(Beep::Accepted),
            show(Screen::Taken {
                name,
                item: item.name.clone(),
                image: item.image.clone(),
            }),
        ]
    }
}

fn beep(beep: Beep) -> Effect {
    Effect::Beep { beep }
}

fn show(screen: Screen) -> Effect {
    Effect::Show { screen }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{Action, Badge, Item, Key, Keys, Named, Office};

    fn state() -> DeviceState {
        let key = |action, label: &str| Key {
            action,
            item_id: None,
            label: label.into(),
        };
        let item = |id: &str, name: &str, stock| Item {
            id: id.into(),
            name: name.into(),
            stock,
            image: String::new(),
        };
        DeviceState {
            device: Named {
                id: "d1".into(),
                name: "Terminal".into(),
            },
            office: Office {
                name: "Lausanne".into(),
                timezone: "Europe/Zurich".into(),
                locale: "fr".into(),
            },
            keys: Keys {
                left: key(Action::Take, "Prendre"),
                right: key(Action::Return, "Ma conso"),
            },
            items: vec![item("i1", "Maté", 36), item("i2", "Zero", 12)],
            badges: vec![Badge {
                uid: "04A1B2C3D4E5F6".into(),
                name: "Alex".into(),
                today: 1,
                week: 4,
                month: 11,
            }],
            sync_times: vec![],
            server_time: "2026-10-09T18:25:00Z".into(),
            firmware: None,
            screen: None,
            app_url: None,
            theme: None,
        }
    }

    fn cx(state: &DeviceState, now_ms: u64) -> Context<'_> {
        Context {
            now_ms,
            unix: Some(1_791_570_300),
            state: Some(state),
            random: 0xabc,
            claim: None,
        }
    }

    fn badge(uid: &str) -> Event {
        Event::Badge { uid: uid.into() }
    }

    fn key(side: Side) -> Event {
        Event::Key { side }
    }

    fn key_event(side: Side) -> Event {
        key(side)
    }

    fn pick(item: &str, stock: i64, index: u32) -> Effect {
        show(Screen::Pick {
            name: "Alex".into(),
            item: item.into(),
            stock,
            image: String::new(),
            index,
            count: 2,
        })
    }

    #[test]
    fn left_key_badge_then_pick_an_item_and_take_it() {
        let s = state();
        let mut flow = Flow::default();
        assert_eq!(
            flow.handle(key(Side::Left), cx(&s, 0)),
            [
                beep(Beep::Key),
                show(Screen::Badge {
                    key_label: "Prendre".into()
                })
            ]
        );
        assert!(flow.wants_badge());
        assert_eq!(
            flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 1_000)),
            [beep(Beep::Accepted), pick("Maté", 36, 0)]
        );
        assert_eq!(
            flow.handle(key(Side::Left), cx(&s, 2_000)),
            [beep(Beep::Key), pick("Zero", 12, 1)]
        );
        assert_eq!(
            flow.handle(key(Side::Right), cx(&s, 5_000)),
            [
                Effect::Queue {
                    take: Take {
                        id: "0000000000000abc".into(),
                        badge_uid: "04A1B2C3D4E5F6".into(),
                        action: Action::Take,
                        item_id: Some("i2".into()),
                        at: "2026-10-09T18:25:00Z".into(),
                    }
                },
                beep(Beep::Accepted),
                show(Screen::Taken {
                    name: "Alex".into(),
                    item: "Zero".into(),
                    image: String::new()
                }),
            ]
        );
        assert_eq!(
            flow.handle(Event::Tick, cx(&s, 5_000 + MESSAGE_MS)),
            [show(Screen::Main)]
        );
        assert!(flow.is_idle());
    }

    #[test]
    fn after_the_last_item_the_right_key_leaves() {
        let s = state();
        let mut flow = Flow::default();
        flow.handle(key(Side::Left), cx(&s, 0));
        flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 1_000));
        flow.handle(key(Side::Left), cx(&s, 2_000));
        assert_eq!(
            flow.handle(key(Side::Left), cx(&s, 3_000)),
            [
                beep(Beep::Key),
                show(Screen::Leave {
                    name: "Alex".into()
                })
            ]
        );
        assert_eq!(
            flow.handle(key(Side::Right), cx(&s, 4_000)),
            [beep(Beep::Key), show(Screen::Main)]
        );
        assert!(flow.is_idle());

        flow.handle(key(Side::Left), cx(&s, 5_000));
        flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 6_000));
        flow.handle(key(Side::Left), cx(&s, 7_000));
        flow.handle(key(Side::Left), cx(&s, 8_000));
        assert_eq!(
            flow.handle(key(Side::Left), cx(&s, 9_000)),
            [beep(Beep::Key), pick("Maté", 36, 0)]
        );
    }

    #[test]
    fn the_picker_gives_up_without_a_key() {
        let s = state();
        let mut flow = Flow::default();
        flow.handle(key(Side::Left), cx(&s, 0));
        flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 1_000));
        assert_eq!(flow.handle(Event::Tick, cx(&s, 1_000 + PICK_MS - 1)), []);
        assert_eq!(
            flow.handle(Event::Tick, cx(&s, 1_000 + PICK_MS)),
            [show(Screen::Main)]
        );
    }

    #[test]
    fn right_key_shows_what_the_person_drank() {
        let s = state();
        let mut flow = Flow::default();
        assert_eq!(
            flow.handle(key(Side::Right), cx(&s, 0))[1],
            show(Screen::Badge {
                key_label: "Ma conso".into()
            })
        );
        assert_eq!(
            flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 1_000)),
            [
                beep(Beep::Accepted),
                show(Screen::Summary {
                    name: "Alex".into(),
                    today: 1,
                    week: 4,
                    month: 11
                })
            ]
        );
        assert_eq!(flow.deadline(), Some(1_000 + SUMMARY_MS));
    }

    #[test]
    fn an_unknown_badge_is_reported_and_nothing_is_queued() {
        let s = state();
        let mut flow = Flow::default();
        flow.handle(key(Side::Left), cx(&s, 0));
        assert_eq!(
            flow.handle(badge("04FFFFFFFFFFFF"), cx(&s, 1_000)),
            [
                beep(Beep::Error),
                Effect::NoteUnknownBadge {
                    uid: "04FFFFFFFFFFFF".into()
                },
                show(Screen::UnknownBadge {
                    uid: "04FFFFFFFFFFFF".into(),
                    claim_url: None
                }),
            ]
        );
        assert_eq!(
            flow.handle(Event::Tick, cx(&s, 1_000 + CLAIM_MS)),
            [show(Screen::Main)]
        );
    }

    #[test]
    fn an_unknown_badge_gets_a_signed_link_to_claim_it() {
        let s = state();
        let key = crate::claim::key("mcd_test-token");
        let claim = Claim {
            site: "http://localhost:3000",
            device_id: "dev1",
            key: &key,
        };
        let mut flow = Flow::default();
        flow.handle(
            key_event(Side::Left),
            Context {
                claim: Some(claim),
                ..cx(&s, 0)
            },
        );
        let effects = flow.handle(
            badge("04A1B2C3D4E5F6FF"),
            Context {
                claim: Some(claim),
                ..cx(&s, 1_000)
            },
        );
        let Effect::Show {
            screen:
                Screen::UnknownBadge {
                    claim_url: Some(url),
                    ..
                },
        } = &effects[2]
        else {
            panic!("no claim link in {effects:?}");
        };
        assert!(url
            .starts_with("http://localhost:3000/badge?d=dev1&u=04A1B2C3D4E5F6FF&t=1791570300&s="));
    }

    #[test]
    fn waiting_for_a_badge_ends_with_a_key_or_the_timeout() {
        let s = state();
        let mut flow = Flow::default();
        flow.handle(key(Side::Left), cx(&s, 0));
        assert_eq!(
            flow.handle(key(Side::Right), cx(&s, 1_000)),
            [beep(Beep::Key), show(Screen::Main)]
        );

        flow.handle(key(Side::Left), cx(&s, 2_000));
        assert_eq!(
            flow.handle(Event::Tick, cx(&s, 2_000 + BADGE_WAIT_MS)),
            [show(Screen::Main)]
        );
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
    fn no_items_no_picker() {
        let mut s = state();
        s.items.clear();
        let mut flow = Flow::default();
        flow.handle(key(Side::Left), cx(&s, 0));
        assert_eq!(
            flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 1_000)),
            [beep(Beep::Error), show(Screen::NoItems)]
        );
    }

    #[test]
    fn speaks_json_to_the_virtual_device() {
        let event: Event = serde_json::from_str(r#"{"type":"key","side":"left"}"#).unwrap();
        assert_eq!(event, key(Side::Left));
        assert_eq!(
            serde_json::from_str::<Event>(r#"{"type":"tick"}"#).unwrap(),
            Event::Tick
        );
        assert_eq!(
            serde_json::to_string(&[
                beep(Beep::Accepted),
                pick("Zero", 12, 1),
                show(Screen::Main)
            ])
            .unwrap(),
            r#"[{"type":"beep","beep":"accepted"},{"type":"show","screen":{"type":"pick","name":"Alex","item":"Zero","stock":12,"image":"","index":1,"count":2}},{"type":"show","screen":{"type":"main"}}]"#
        );
    }

    #[test]
    fn before_the_first_sync_it_says_so() {
        let s = state();
        let mut flow = Flow::default();
        let no_clock = Context {
            unix: None,
            ..cx(&s, 0)
        };
        assert_eq!(
            flow.handle(key(Side::Left), no_clock),
            [beep(Beep::Error), show(Screen::NotReady)]
        );
        // A key during the message starts over, now that the sync has happened.
        assert!(matches!(
            flow.handle(key(Side::Left), cx(&s, 1_000))[1],
            Effect::Show {
                screen: Screen::Badge { .. }
            }
        ));
    }
}
