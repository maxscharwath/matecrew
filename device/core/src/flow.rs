//! The terminal's flow as a state machine without clock or hardware. A runtime
//! (the firmware, or the virtual device in device/web) feeds it events with
//! the time, and carries out the effects it returns.
//!
//! Left key → "put your badge" → badge → the items one by one: the left key
//! shows the next one, the right key takes it. After the last item comes a
//! card to leave without taking anything.
//! Right key → "put your badge" → badge → "Mon compte", live from the site
//! (`Effect::FetchAccount`; the runtime answers with an event): what the person
//! drank today, this week and this month, the last days and the latest
//! purchases. Its left key lists the purchases, a page at a time: the left key
//! moves through them, the right key cancels the selected one after a second
//! press (`Effect::CancelPurchase`), the way back returns to the account.
//! While the site shows a preparation, the right key is "Servi": a runner's
//! badge closes the session (`Effect::Serve`).
//! Right key held → "put your badge" → badge → the purchases straight away. A
//! long press anywhere else is the short one.
//! Nothing personal is kept on the terminal: without the site, the account
//! says why (`Screen::Failed`).

use crate::{
    claim::Claim,
    contract::{Account, DeviceState, Purchase, Side, Take, ACCOUNT_PATH, CANCEL_PURCHASE_PATH},
    time,
};
use serde::{Deserialize, Serialize};

/// How long the terminal waits for a badge after a key press.
pub const BADGE_WAIT_MS: u64 = 15_000;
/// How long the item picker stays without a key press.
pub const PICK_MS: u64 = 20_000;
/// How long a message (taken, unknown badge, not ready) stays before the main screen returns.
pub const MESSAGE_MS: u64 = 5_000;
/// How long the account and the purchases stay without a key press.
pub const ACCOUNT_MS: u64 = 20_000;
/// How long a failure stays: time to read it, and to try again.
pub const FAILURE_MS: u64 = 10_000;
/// How long an unknown badge's claim QR stays.
pub const CLAIM_MS: u64 = 30_000;
/// How long the about page (both keys) stays without a key press.
pub const ABOUT_MS: u64 = 60_000;
/// How long the terminal waits for the site's account, or for a cancellation.
pub const LOAD_MS: u64 = 20_000;
/// Purchases on one page of the list.
pub const PURCHASES_PAGE: usize = 4;
/// The latest purchases the account shows.
pub const ACCOUNT_PURCHASES: usize = 2;

/// In JSON: `{"type":"key","side":"left"}`, `{"type":"bothKeys"}`, `{"type":"badge","uid":"04A1…"}`,
/// `{"type":"tick"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    Key {
        side: Side,
    },
    /// Both keys together (`hardware::TouchKeys`): the terminal's about page, from anywhere.
    BothKeys,
    /// A badge UID, as `normalize_uid` gives it.
    Badge {
        uid: String,
    },
    /// A key held long (`hardware::TouchKeys`).
    LongKey {
        side: Side,
    },
    /// The site's answer to `Effect::FetchAccount`.
    Account {
        account: Account,
    },
    /// `Effect::FetchAccount` or `Effect::CancelPurchase` got no usable answer.
    AccountFailed {
        failure: Failure,
    },
    /// The site's answer to `Effect::CancelPurchase`.
    PurchaseCancelled {
        cancelled: bool,
    },
    /// Nothing happened: lets a deadline pass. Send one at `Flow::deadline`.
    Tick,
}

/// Why the site gave no usable answer, as the failure screen tells it. In JSON:
/// `{"kind":"offline","cause":"timeout"}`, `{"kind":"site","status":503}`, `{"kind":"unreadable"}`,
/// `{"kind":"unknownBadge"}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Failure {
    /// The site was out of reach.
    Offline { cause: Cause },
    /// The site answered with an error status.
    Site { status: u16 },
    /// The site answered, but not in a shape this terminal reads: a site older or newer than it.
    Unreadable,
    /// The site knows nobody with this badge in the terminal's office.
    UnknownBadge,
}

impl Failure {
    /// Trying again may help, unless the site does not know the badge.
    pub fn retry(&self) -> bool {
        !matches!(self, Failure::UnknownBadge)
    }
}

/// What kept the site out of reach.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Cause {
    /// The terminal is not on the Wi-Fi.
    Wifi,
    /// The site took too long to answer.
    Timeout,
    /// No connection to the site could be opened.
    Connect,
    /// The secure connection failed: certificate, clock or handshake.
    Tls,
    /// The site's name did not resolve.
    Dns,
    /// Anything else on the way.
    Network,
}

/// What the terminal asked the site when it failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Task {
    Account,
    /// The account, for the purchases list.
    Purchases,
    Cancel,
}

impl Task {
    /// The endpoint, for the failure's technical line.
    pub fn path(self) -> &'static str {
        match self {
            Task::Account | Task::Purchases => ACCOUNT_PATH,
            Task::Cancel => CANCEL_PURCHASE_PATH,
        }
    }
}

/// A purchase as the list shows it; `picture` as in `contract::Item`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseRow {
    pub item: String,
    pub when: String,
    #[serde(default)]
    pub price: Option<String>,
    pub picture: String,
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

/// In JSON: `{"type":"pick","name":"Alex","item":"Maté Zero","stock":12,"picture":"…","index":1,"count":3}`.
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
    /// One item to take; `picture` as in `contract::Item`.
    Pick {
        name: String,
        item: String,
        stock: i64,
        picture: String,
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
    /// Version, build, network and battery: the host's `$device`, nothing from the flow.
    About,
    /// The preparation was served: who, and how many orders.
    Served {
        name: String,
        count: u32,
    },
    /// The right key, or held (`purchases`): the badge whose account to show.
    AccountBadge {
        purchases: bool,
    },
    /// The site is asked for the account, or (`cancelling`) to cancel a purchase.
    AccountLoading {
        name: String,
        cancelling: bool,
    },
    /// "Mon compte", as the site counts it now: `days` per product, oldest first, named by
    /// `labels`; `recent`, the latest purchases.
    Account {
        name: String,
        today: u32,
        week: u32,
        month: u32,
        cost: Option<String>,
        days: Vec<Vec<u32>>,
        products: Vec<String>,
        labels: Vec<String>,
        recent: Vec<PurchaseRow>,
    },
    /// A page of the purchases. `selected` is the row on this page, `rows.len()` for the way
    /// back to the account, which ends the last page (`back`). With `confirm`, the selected
    /// purchase waits for a second press to be cancelled.
    Purchases {
        name: String,
        rows: Vec<PurchaseRow>,
        selected: u32,
        back: bool,
        page: u32,
        pages: u32,
        confirm: bool,
    },
    /// The site gave no usable answer to `task`. The left key tries again when
    /// `failure.retry()`.
    Failed {
        task: Task,
        failure: Failure,
    },
}

/// In JSON: `"key"`, `"accepted"`, `"error"`, `"notification"`, `"badge"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Beep {
    Key,
    Accepted,
    Error,
    Notification,
    /// A known badge was read.
    Badge,
    /// The terminal starts.
    Boot,
    /// A badge nobody has claimed yet.
    Unknown,
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
    /// Serve the preparation's session now (`contract::ServeRequest`), then show
    /// `Screen::Served` with the count the site answers, or an error.
    Serve {
        uid: String,
        name: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
    },
    /// Ask the site for the badge holder's account; answer with `Event::Account` or
    /// `Event::AccountFailed`.
    FetchAccount {
        uid: String,
    },
    /// Cancel one of the badge holder's purchases; answer with `Event::PurchaseCancelled` or
    /// `Event::AccountFailed`.
    CancelPurchase {
        uid: String,
        id: String,
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
    About {
        until: u64,
    },
    /// `list`: the right key was held, the purchases come first.
    AwaitAccountBadge {
        list: bool,
        until: u64,
    },
    /// Waiting for the site. `list` is the purchase to select once the account arrives, None
    /// for the account screen; `cancelling` while the site cancels one.
    AccountLoading {
        uid: String,
        name: String,
        list: Option<usize>,
        cancelling: bool,
        until: u64,
    },
    Account {
        uid: String,
        account: Account,
        until: u64,
    },
    Purchases {
        uid: String,
        account: Account,
        /// The selected purchase, `account.purchases.len()` for the way back.
        index: usize,
        confirm: bool,
        until: u64,
    },
    /// The site gave no usable answer; with `retry`, the left key asks again.
    Failed {
        uid: String,
        name: String,
        list: Option<usize>,
        retry: bool,
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
        matches!(self.stage, Stage::AwaitBadge { .. } | Stage::AwaitAccountBadge { .. })
    }

    /// When to send a `Tick` at the latest, in `now_ms` time.
    pub fn deadline(&self) -> Option<u64> {
        match self.stage {
            Stage::Idle => None,
            Stage::AwaitBadge { until, .. }
            | Stage::Pick { until, .. }
            | Stage::Message { until }
            | Stage::About { until }
            | Stage::AwaitAccountBadge { until, .. }
            | Stage::AccountLoading { until, .. }
            | Stage::Account { until, .. }
            | Stage::Purchases { until, .. }
            | Stage::Failed { until, .. } => Some(until),
        }
    }

    pub fn handle(&mut self, event: Event, cx: Context) -> Vec<Effect> {
        let expired = self.deadline().is_some_and(|until| cx.now_ms >= until);
        // A long press is the short one, except the right key's from the main screen.
        let event = match (&self.stage, event) {
            (Stage::Idle | Stage::Message { .. }, Event::LongKey { side: Side::Right }) => {
                return self.ask_for_account_badge(true, cx);
            }
            (_, Event::LongKey { side }) => Event::Key { side },
            (_, event) => event,
        };
        match (std::mem::take(&mut self.stage), event) {
            // Whatever the terminal was doing: a take not confirmed yet is dropped, as on a timeout.
            (_, Event::BothKeys) => {
                self.stage = Stage::About {
                    until: cx.now_ms + ABOUT_MS,
                };
                vec![beep(Beep::Key), show(Screen::About)]
            }
            (Stage::About { .. }, Event::Key { .. }) => vec![beep(Beep::Key), show(Screen::Main)],

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

            (Stage::AwaitAccountBadge { list, .. }, Event::Badge { uid }) => self.read_account_badge(uid, list, cx),
            (Stage::AwaitAccountBadge { .. }, Event::Key { .. }) => vec![beep(Beep::Key), show(Screen::Main)],
            (Stage::AccountLoading { uid, list: None, .. }, Event::Account { account }) => {
                self.account(uid, account, cx, None)
            }
            (Stage::AccountLoading { uid, list: Some(index), .. }, Event::Account { account }) => {
                self.list_purchases(uid, account, index, false, cx, None)
            }
            (Stage::AccountLoading { uid, name, list, cancelling: true, .. }, Event::PurchaseCancelled { cancelled }) => {
                // The account again, as the site now counts it, back on the list.
                self.stage = Stage::AccountLoading { uid: uid.clone(), name: name.clone(), list, cancelling: false, until: cx.now_ms + LOAD_MS };
                vec![
                    beep(if cancelled { Beep::Accepted } else { Beep::Error }),
                    show(Screen::AccountLoading { name, cancelling: false }),
                    Effect::FetchAccount { uid },
                ]
            }
            (Stage::AccountLoading { uid, name, list, cancelling, .. }, Event::AccountFailed { failure }) => {
                let task = match (cancelling, list) {
                    (true, _) => Task::Cancel,
                    (false, Some(_)) => Task::Purchases,
                    (false, None) => Task::Account,
                };
                self.stage = Stage::Failed { uid, name, list, retry: failure.retry(), until: cx.now_ms + FAILURE_MS };
                vec![beep(Beep::Error), show(Screen::Failed { task, failure })]
            }
            (Stage::Account { uid, account, .. }, Event::Key { side: Side::Left }) => {
                self.list_purchases(uid, account, 0, false, cx, Some(Beep::Key))
            }
            (Stage::Account { .. }, Event::Key { side: Side::Right }) => vec![beep(Beep::Key), show(Screen::Main)],
            // "Garder": the same purchase, not cancelled.
            (Stage::Purchases { uid, account, index, confirm: true, .. }, Event::Key { side: Side::Left }) => {
                self.list_purchases(uid, account, index, false, cx, Some(Beep::Key))
            }
            (Stage::Purchases { uid, account, index, .. }, Event::Key { side: Side::Left }) => {
                let next = (index + 1) % (account.purchases.len() + 1);
                self.list_purchases(uid, account, next, false, cx, Some(Beep::Key))
            }
            (Stage::Purchases { uid, account, index, .. }, Event::Key { side: Side::Right }) if index >= account.purchases.len() => {
                self.account(uid, account, cx, Some(Beep::Key))
            }
            (Stage::Purchases { uid, account, index, confirm: false, .. }, Event::Key { side: Side::Right }) => {
                self.list_purchases(uid, account, index, true, cx, Some(Beep::Key))
            }
            (Stage::Purchases { uid, account, index, confirm: true, .. }, Event::Key { side: Side::Right }) => {
                let id = account.purchases[index].id.clone();
                let name = account.name;
                self.stage = Stage::AccountLoading { uid: uid.clone(), name: name.clone(), list: Some(index), cancelling: true, until: cx.now_ms + LOAD_MS };
                vec![beep(Beep::Key), show(Screen::AccountLoading { name, cancelling: true }), Effect::CancelPurchase { uid, id }]
            }
            (Stage::Failed { uid, name, list, retry: true, .. }, Event::Key { side: Side::Left }) => {
                self.stage = Stage::AccountLoading { uid: uid.clone(), name: name.clone(), list, cancelling: false, until: cx.now_ms + LOAD_MS };
                vec![beep(Beep::Key), show(Screen::AccountLoading { name, cancelling: false }), Effect::FetchAccount { uid }]
            }
            (Stage::Failed { .. }, Event::Key { .. }) => vec![beep(Beep::Key), show(Screen::Main)],

            (
                Stage::AwaitBadge { .. }
                | Stage::Pick { .. }
                | Stage::Message { .. }
                | Stage::About { .. }
                | Stage::AwaitAccountBadge { .. }
                | Stage::AccountLoading { .. }
                | Stage::Account { .. }
                | Stage::Purchases { .. }
                | Stage::Failed { .. },
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
        // Outside a preparation, the right key is the account: it needs the badges, not the clock.
        if side == Side::Right && cx.state.is_some_and(|state| preparing(state).is_none()) {
            return self.ask_for_account_badge(false, cx);
        }
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
                key_label: match (side, preparing(state)) {
                    (Side::Right, Some(preparation)) => preparation.serve_label.clone(),
                    _ => state.key(side).label.clone(),
                },
            }),
        ]
    }

    fn ask_for_account_badge(&mut self, list: bool, cx: Context) -> Vec<Effect> {
        if cx.state.is_none() {
            self.message(cx, MESSAGE_MS);
            return vec![beep(Beep::Error), show(Screen::NotReady)];
        }
        self.stage = Stage::AwaitAccountBadge { list, until: cx.now_ms + BADGE_WAIT_MS };
        vec![beep(Beep::Key), show(Screen::AccountBadge { purchases: list })]
    }

    /// A known badge asks the site for its account; with `list`, for the purchases first.
    fn read_account_badge(&mut self, uid: String, list: bool, cx: Context) -> Vec<Effect> {
        let Some(name) = cx.state.and_then(|state| state.badge(&uid)).map(|badge| badge.name.clone()) else {
            // As for a take: a badge nobody has is linked first.
            return self.unknown_badge(uid, cx);
        };
        let list = list.then_some(0);
        self.stage = Stage::AccountLoading { uid: uid.clone(), name: name.clone(), list, cancelling: false, until: cx.now_ms + LOAD_MS };
        vec![beep(Beep::Badge), show(Screen::AccountLoading { name, cancelling: false }), Effect::FetchAccount { uid }]
    }

    /// The account screen, and the stage that waits for a key.
    fn account(&mut self, uid: String, account: Account, cx: Context, sound: Option<Beep>) -> Vec<Effect> {
        let screen = Screen::Account {
            name: account.name.clone(),
            today: account.today,
            week: account.week,
            month: account.month,
            cost: account.cost.clone(),
            days: account.days.clone(),
            products: account.products.clone(),
            labels: account.labels.clone(),
            recent: account.purchases.iter().take(ACCOUNT_PURCHASES).map(|purchase| row(purchase, cx)).collect(),
        };
        self.stage = Stage::Account { uid, account, until: cx.now_ms + ACCOUNT_MS };
        sound.map(beep).into_iter().chain([show(screen)]).collect()
    }

    /// The page of the purchases holding `index`, and the stage that waits for a key.
    fn list_purchases(
        &mut self,
        uid: String,
        account: Account,
        index: usize,
        confirm: bool,
        cx: Context,
        sound: Option<Beep>,
    ) -> Vec<Effect> {
        let purchases = &account.purchases;
        let index = index.min(purchases.len());
        let page = index / PURCHASES_PAGE;
        let pages = purchases.len() / PURCHASES_PAGE + 1;
        let start = page * PURCHASES_PAGE;
        let rows = purchases[start.min(purchases.len())..(start + PURCHASES_PAGE).min(purchases.len())]
            .iter()
            .map(|purchase| row(purchase, cx))
            .collect();
        let screen = Screen::Purchases {
            name: account.name.clone(),
            rows,
            selected: (index - start) as u32,
            back: page + 1 == pages,
            page: page as u32,
            pages: pages as u32,
            confirm: confirm && index < purchases.len(),
        };
        self.stage = Stage::Purchases { uid, account, index, confirm, until: cx.now_ms + ACCOUNT_MS };
        sound.map(beep).into_iter().chain([show(screen)]).collect()
    }

    /// Time to find the phone and scan: the claim QR, and the badge reported to the site.
    fn unknown_badge(&mut self, uid: String, cx: Context) -> Vec<Effect> {
        self.message(cx, CLAIM_MS);
        let claim_url = cx
            .claim
            .zip(cx.unix)
            .map(|(claim, unix)| claim.url(&uid, unix));
        vec![
            beep(Beep::Unknown),
            Effect::NoteUnknownBadge { uid: uid.clone() },
            show(Screen::UnknownBadge { uid, claim_url }),
        ]
    }

    fn read_badge(&mut self, side: Side, uid: String, cx: Context) -> Vec<Effect> {
        // ask_for_badge only gets here with a state.
        let Some(state) = cx.state else {
            return vec![show(Screen::Main)];
        };
        let Some(badge) = state.badge(&uid) else {
            return self.unknown_badge(uid, cx);
        };
        if let (Side::Right, Some(preparation)) = (side, preparing(state)) {
            // The runtime answers with the site's count; the message stage brings the main screen back.
            self.message(cx, MESSAGE_MS);
            return vec![
                beep(Beep::Badge),
                Effect::Serve {
                    uid,
                    name: badge.name.clone(),
                    session_id: preparation.session_id.clone(),
                },
            ];
        }
        match side {
            // The preparation was served meanwhile: the right key is the account again.
            Side::Right => self.read_account_badge(uid, false, cx),
            Side::Left if state.items.is_empty() => {
                self.message(cx, MESSAGE_MS);
                vec![beep(Beep::Error), show(Screen::NoItems)]
            }
            Side::Left => self.pick(uid, badge.name.clone(), 0, cx, Beep::Badge),
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
            picture: item.picture.clone(),
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
            item_id: Some(item.id.clone()),
            at: time::format_iso(unix),
        };
        self.message(cx, MESSAGE_MS);
        vec![
            Effect::Queue { take },
            beep(Beep::Accepted),
            show(Screen::Taken { name, item: item.name.clone() }),
        ]
    }
}

/// A purchase as a list row, with the item's picture from the last sync.
fn row(purchase: &Purchase, cx: Context) -> PurchaseRow {
    let item = cx.state.and_then(|state| state.items.iter().find(|item| item.id == purchase.item_id));
    PurchaseRow {
        item: purchase.item.clone(),
        when: purchase.when.clone(),
        price: purchase.price.clone(),
        picture: item.map_or_else(String::new, |item| item.picture.clone()),
    }
}

/// The site shows a preparation: the right key serves it.
fn preparing(state: &DeviceState) -> Option<&crate::contract::Preparation> {
    state.screen.preparation.as_ref()
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
    use crate::contract::{Badge, Item, Key, Keys, Named, Office};

    fn state() -> DeviceState {
        let key = |label: &str| Key { label: label.into() };
        let item = |id: &str, name: &str, stock| Item {
            id: id.into(),
            name: name.into(),
            stock,
            picture: String::new(),
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
                left: key("Prendre"),
                right: key("Mon compte"),
            },
            items: vec![item("i1", "Maté", 36), item("i2", "Zero", 12)],
            badges: vec![Badge {
                uid: "04A1B2C3D4E5F6".into(),
                name: "Alex".into(),
            }],
            sync_times: vec![],
            server_time: "2026-10-09T18:25:00Z".into(),
            firmware: None,
            screen: serde_json::from_str(include_str!("../../fixtures/dashboard.json")).unwrap(),
            app_url: None,
            theme: "paper".into(),
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
            picture: String::new(),
            index,
            count: 2,
        })
    }

    #[test]
    fn during_a_preparation_the_right_key_serves_it_with_a_badge() {
        let mut s = state();
        s.screen.preparation = serde_json::from_value(serde_json::json!({
            "title": "À préparer", "total": "8 matés", "items": [],
            "sessionId": "s1", "serveLabel": "Servi"
        }))
        .unwrap();
        let mut flow = Flow::default();
        assert_eq!(
            flow.handle(key(Side::Right), cx(&s, 0)),
            [beep(Beep::Key), show(Screen::Badge { key_label: "Servi".into() })]
        );
        assert_eq!(
            flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 1_000)),
            [
                beep(Beep::Badge),
                Effect::Serve {
                    uid: "04A1B2C3D4E5F6".into(),
                    name: "Alex".into(),
                    session_id: Some("s1".into()),
                }
            ]
        );
        assert_eq!(flow.handle(Event::Tick, cx(&s, 1_000 + MESSAGE_MS)), [show(Screen::Main)]);
        // The left key still takes.
        assert_eq!(
            flow.handle(key(Side::Left), cx(&s, 20_000)),
            [beep(Beep::Key), show(Screen::Badge { key_label: "Prendre".into() })]
        );
        assert_eq!(
            serde_json::to_value(Effect::Serve { uid: "U".into(), name: "A".into(), session_id: None }).unwrap(),
            serde_json::json!({"type":"serve","uid":"U","name":"A","sessionId":null})
        );
    }

    #[test]
    fn both_keys_open_the_about_page_from_anywhere_and_a_key_closes_it() {
        let s = state();
        let mut flow = Flow::default();
        let about = [beep(Beep::Key), show(Screen::About)];
        assert_eq!(flow.handle(Event::BothKeys, cx(&s, 0)), about);
        assert!(!flow.wants_badge());
        assert_eq!(flow.deadline(), Some(ABOUT_MS));
        assert_eq!(flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 100)), []);
        assert_eq!(
            flow.handle(key(Side::Left), cx(&s, 1_000)),
            [beep(Beep::Key), show(Screen::Main)]
        );
        assert!(flow.is_idle());
        // In the middle of a take: the pick is dropped, nothing is queued.
        flow.handle(key(Side::Left), cx(&s, 2_000));
        flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 2_500));
        assert_eq!(flow.handle(Event::BothKeys, cx(&s, 3_000)), about);
        assert_eq!(
            flow.handle(Event::Tick, cx(&s, 3_000 + ABOUT_MS)),
            [show(Screen::Main)]
        );
        assert!(flow.is_idle());
        assert_eq!(
            serde_json::to_value(Event::BothKeys).unwrap(),
            serde_json::json!({"type":"bothKeys"})
        );
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
            [beep(Beep::Badge), pick("Maté", 36, 0)]
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
                        item_id: Some("i2".into()),
                        at: "2026-10-09T18:25:00Z".into(),
                    }
                },
                beep(Beep::Accepted),
                show(Screen::Taken {
                    name: "Alex".into(),
                    item: "Zero".into(),
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

    /// What the site answers for Alex: `count` purchases, newest first.
    fn account(count: usize) -> Account {
        Account {
            name: "Alex".into(),
            today: 1,
            week: 4,
            month: 11,
            cost: Some("CHF 12.40".into()),
            days: vec![vec![0], vec![2], vec![1], vec![0], vec![0], vec![1], vec![1]],
            products: vec!["Maté".into()],
            labels: ["ven", "sam", "dim", "lun", "mar", "mer", "jeu"].map(String::from).to_vec(),
            purchases: (1..=count).map(|n| purchase(&format!("c{n}"))).collect(),
        }
    }

    fn row() -> PurchaseRow {
        PurchaseRow { item: "Maté".into(), when: "14:05".into(), price: Some("1.20".into()), picture: String::new() }
    }

    fn loading(cancelling: bool) -> Effect {
        show(Screen::AccountLoading { name: "Alex".into(), cancelling })
    }

    fn fetch() -> Effect {
        Effect::FetchAccount { uid: "04A1B2C3D4E5F6".into() }
    }

    #[test]
    fn right_key_shows_the_account_live_from_the_site() {
        let s = state();
        let mut flow = Flow::default();
        assert_eq!(
            flow.handle(key(Side::Right), cx(&s, 0)),
            [beep(Beep::Key), show(Screen::AccountBadge { purchases: false })]
        );
        assert!(flow.wants_badge());
        assert_eq!(flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 1_000)), [beep(Beep::Badge), loading(false), fetch()]);
        assert_eq!(flow.deadline(), Some(1_000 + LOAD_MS));
        assert_eq!(
            flow.handle(Event::Account { account: account(5) }, cx(&s, 1_500)),
            [show(Screen::Account {
                name: "Alex".into(),
                today: 1,
                week: 4,
                month: 11,
                cost: Some("CHF 12.40".into()),
                days: vec![vec![0], vec![2], vec![1], vec![0], vec![0], vec![1], vec![1]],
                products: vec!["Maté".into()],
                labels: ["ven", "sam", "dim", "lun", "mar", "mer", "jeu"].map(String::from).to_vec(),
                recent: vec![row(); ACCOUNT_PURCHASES],
            })]
        );
        assert_eq!(flow.deadline(), Some(1_500 + ACCOUNT_MS));
        // "Fermer".
        assert_eq!(flow.handle(key(Side::Right), cx(&s, 2_000)), [beep(Beep::Key), show(Screen::Main)]);
        assert!(flow.is_idle());
        // Without a key, the account goes away too.
        flow.handle(key(Side::Right), cx(&s, 3_000));
        flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 3_100));
        flow.handle(Event::Account { account: account(0) }, cx(&s, 3_200));
        assert_eq!(flow.handle(Event::Tick, cx(&s, 3_200 + ACCOUNT_MS)), [show(Screen::Main)]);
    }

    #[test]
    fn the_account_needs_the_badges_not_the_clock() {
        let s = state();
        let mut flow = Flow::default();
        let no_clock = Context { unix: None, ..cx(&s, 0) };
        assert_eq!(flow.handle(key(Side::Right), no_clock), [beep(Beep::Key), show(Screen::AccountBadge { purchases: false })]);
        let no_state = Context { state: None, ..cx(&s, 100) };
        assert_eq!(flow.handle(key(Side::Left), no_state), [beep(Beep::Key), show(Screen::Main)]);
        assert_eq!(flow.handle(key(Side::Right), no_state), [beep(Beep::Error), show(Screen::NotReady)]);
    }

    #[test]
    fn an_unknown_badge_is_reported_and_nothing_is_queued() {
        let s = state();
        let mut flow = Flow::default();
        flow.handle(key(Side::Left), cx(&s, 0));
        assert_eq!(
            flow.handle(badge("04FFFFFFFFFFFF"), cx(&s, 1_000)),
            [
                beep(Beep::Unknown),
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
            r#"[{"type":"beep","beep":"accepted"},{"type":"show","screen":{"type":"pick","name":"Alex","item":"Zero","stock":12,"picture":"","index":1,"count":2}},{"type":"show","screen":{"type":"main"}}]"#
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

    fn purchase(id: &str) -> Purchase {
        Purchase {
            id: id.into(),
            item_id: "i1".into(),
            item: "Maté".into(),
            when: "14:05".into(),
            price: Some("1.20".into()),
        }
    }

    #[test]
    fn the_account_lists_the_purchases_without_a_second_badge_and_one_is_cancelled_after_a_second_press() {
        let s = state();
        let mut flow = Flow::default();
        flow.handle(key(Side::Right), cx(&s, 0));
        flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 500));
        flow.handle(Event::Account { account: account(5) }, cx(&s, 900));
        // "Mes achats": five purchases, two pages of four, the way back ending the second.
        let effects = flow.handle(key(Side::Left), cx(&s, 1_000));
        assert!(!flow.wants_badge());
        let Some(Effect::Show { screen: Screen::Purchases { name, rows, selected, back, page, pages, confirm } }) = effects.last() else {
            panic!("{effects:?}");
        };
        assert_eq!((name.as_str(), rows.len(), *selected, *back, *page, *pages, *confirm), ("Alex", 4, 0, false, 0, 2, false));

        // Left moves on; the fifth is on the second page with the way back.
        for _ in 0..4 {
            flow.handle(key(Side::Left), cx(&s, 1_100));
        }
        let effects = flow.handle(key(Side::Right), cx(&s, 1_200));
        let Some(Effect::Show { screen: Screen::Purchases { rows, selected, back, page, confirm, .. } }) = effects.last() else {
            panic!("{effects:?}");
        };
        assert_eq!((rows.len(), *selected, *back, *page, *confirm), (1, 0, true, 1, true));
        // "Garder" keeps it, and stays on it.
        let effects = flow.handle(key(Side::Left), cx(&s, 1_250));
        let Some(Effect::Show { screen: Screen::Purchases { selected, page, confirm, .. } }) = effects.last() else {
            panic!("{effects:?}");
        };
        assert_eq!((*selected, *page, *confirm), (0, 1, false));
        flow.handle(key(Side::Right), cx(&s, 1_300));

        // The second press cancels it, then the account comes again, back on the list.
        let effects = flow.handle(key(Side::Right), cx(&s, 1_400));
        assert_eq!(effects[1..], [loading(true), Effect::CancelPurchase { uid: "04A1B2C3D4E5F6".into(), id: "c5".into() }]);
        let effects = flow.handle(Event::PurchaseCancelled { cancelled: true }, cx(&s, 1_500));
        assert_eq!(effects, [beep(Beep::Accepted), loading(false), fetch()]);
        let effects = flow.handle(Event::Account { account: account(4) }, cx(&s, 1_800));
        let Some(Effect::Show { screen: Screen::Purchases { rows, selected, back, pages, .. } }) = effects.last() else {
            panic!("{effects:?}");
        };
        // The fifth is gone: the way back is selected, alone on the second page.
        assert_eq!((rows.len(), *selected, *back, *pages), (0, 0, true, 2));
        // "Retour": the account again, not the stock.
        let effects = flow.handle(key(Side::Right), cx(&s, 1_900));
        assert!(matches!(effects.last(), Some(Effect::Show { screen: Screen::Account { .. } })), "{effects:?}");
        assert_eq!(flow.deadline(), Some(1_900 + ACCOUNT_MS));
    }

    #[test]
    fn a_long_press_on_the_right_goes_straight_to_the_purchases_and_back_leads_to_the_account() {
        let s = state();
        let mut flow = Flow::default();
        let long_right = Event::LongKey { side: Side::Right };
        assert_eq!(flow.handle(long_right, cx(&s, 0)), [beep(Beep::Key), show(Screen::AccountBadge { purchases: true })]);
        assert!(flow.wants_badge());
        assert_eq!(flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 500)), [beep(Beep::Badge), loading(false), fetch()]);
        let effects = flow.handle(Event::Account { account: account(2) }, cx(&s, 900));
        let [Effect::Show { screen: Screen::Purchases { rows, selected, back, .. } }] = &effects[..] else {
            panic!("{effects:?}");
        };
        assert_eq!((rows.len(), *selected, *back), (2, 0, true));
        flow.handle(key(Side::Left), cx(&s, 1_000));
        flow.handle(key(Side::Left), cx(&s, 1_100));
        let effects = flow.handle(key(Side::Right), cx(&s, 1_200));
        assert!(matches!(effects.last(), Some(Effect::Show { screen: Screen::Account { .. } })), "{effects:?}");
        // From the account, the list again, then the stock.
        flow.handle(key(Side::Left), cx(&s, 1_300));
        assert_eq!(flow.handle(Event::Tick, cx(&s, 1_300 + ACCOUNT_MS)), [show(Screen::Main)]);
    }

    #[test]
    fn a_long_press_is_the_short_one_elsewhere() {
        let s = state();
        let mut flow = Flow::default();
        // A long left press from the main screen asks for the badge, as a short one.
        let effects = flow.handle(Event::LongKey { side: Side::Left }, cx(&s, 0));
        assert!(matches!(effects.last(), Some(Effect::Show { screen: Screen::Badge { .. } })));
        // A long right press while a badge is awaited is a short one: back to the stock.
        assert_eq!(flow.handle(Event::LongKey { side: Side::Right }, cx(&s, 100)), [beep(Beep::Key), show(Screen::Main)]);
    }

    #[test]
    fn each_failure_says_what_went_wrong_and_the_left_key_tries_again() {
        let s = state();
        let mut flow = Flow::default();
        flow.handle(key(Side::Right), cx(&s, 0));
        flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 100));
        let offline = Failure::Offline { cause: Cause::Timeout };
        assert_eq!(
            flow.handle(Event::AccountFailed { failure: offline }, cx(&s, 200)),
            [beep(Beep::Error), show(Screen::Failed { task: Task::Account, failure: offline })]
        );
        assert_eq!(flow.deadline(), Some(200 + FAILURE_MS));
        // "Réessayer": the same request, no badge again.
        assert_eq!(flow.handle(key(Side::Left), cx(&s, 300)), [beep(Beep::Key), loading(false), fetch()]);
        flow.handle(Event::Account { account: account(1) }, cx(&s, 400));
        // A failed cancellation says so, on the list's behalf.
        flow.handle(key(Side::Left), cx(&s, 500));
        flow.handle(key(Side::Right), cx(&s, 600));
        flow.handle(key(Side::Right), cx(&s, 700));
        let site = Failure::Site { status: 503 };
        assert_eq!(
            flow.handle(Event::AccountFailed { failure: site }, cx(&s, 800)),
            [beep(Beep::Error), show(Screen::Failed { task: Task::Cancel, failure: site })]
        );
        // Trying again lands on the list.
        assert_eq!(flow.handle(key(Side::Left), cx(&s, 900)), [beep(Beep::Key), loading(false), fetch()]);
        let effects = flow.handle(Event::Account { account: account(1) }, cx(&s, 1_000));
        assert!(matches!(effects.last(), Some(Effect::Show { screen: Screen::Purchases { .. } })), "{effects:?}");

        // The site does not know the badge: nothing to try again, either key closes.
        flow.handle(Event::LongKey { side: Side::Right }, cx(&s, 2_000));
        flow.handle(Event::Tick, cx(&s, 2_000 + ACCOUNT_MS));
        flow.handle(Event::LongKey { side: Side::Right }, cx(&s, 30_000));
        flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 30_100));
        assert_eq!(
            flow.handle(Event::AccountFailed { failure: Failure::UnknownBadge }, cx(&s, 30_200)),
            [beep(Beep::Error), show(Screen::Failed { task: Task::Purchases, failure: Failure::UnknownBadge })]
        );
        assert_eq!(flow.handle(key(Side::Left), cx(&s, 30_300)), [beep(Beep::Key), show(Screen::Main)]);

        // Nothing waits for the site past its deadline, and a late answer is dropped.
        flow.handle(key(Side::Right), cx(&s, 40_000));
        flow.handle(badge("04A1B2C3D4E5F6"), cx(&s, 40_100));
        assert_eq!(flow.handle(Event::Tick, cx(&s, 40_100 + LOAD_MS)), [show(Screen::Main)]);
        assert_eq!(flow.handle(Event::Account { account: account(1) }, cx(&s, 40_100 + LOAD_MS + 1)), []);
    }

    #[test]
    fn speaks_the_account_in_json_to_the_virtual_device() {
        assert_eq!(
            serde_json::from_str::<Event>(r#"{"type":"accountFailed","failure":{"kind":"offline","cause":"wifi"}}"#).unwrap(),
            Event::AccountFailed { failure: Failure::Offline { cause: Cause::Wifi } }
        );
        assert_eq!(
            serde_json::from_str::<Event>(r#"{"type":"accountFailed","failure":{"kind":"unknownBadge"}}"#).unwrap(),
            Event::AccountFailed { failure: Failure::UnknownBadge }
        );
        assert_eq!(
            serde_json::to_value(Screen::Failed { task: Task::Cancel, failure: Failure::Site { status: 500 } }).unwrap(),
            serde_json::json!({"type":"failed","task":"cancel","failure":{"kind":"site","status":500}})
        );
        assert_eq!(
            serde_json::to_value(fetch()).unwrap(),
            serde_json::json!({"type":"fetchAccount","uid":"04A1B2C3D4E5F6"})
        );
        assert_eq!(Task::Cancel.path(), "/api/device/purchases/cancel");
    }
}
