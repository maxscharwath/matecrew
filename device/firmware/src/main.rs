//! matécrew badge terminal: Wi-Fi setup by QR, linking with a code shown on
//! the panel, takes with a key and a badge, and syncs that send the takes and
//! draw the screen the site renders.

mod api;
mod buzzer;
mod console;
mod display;
mod keys;
mod nfc;
mod portal;
mod store;
mod wifi;

use anyhow::{bail, Result};
use esp_idf_svc::{
    eventloop::EspSystemEventLoop,
    hal::{peripherals::Peripherals, reset},
    nvs::EspDefaultNvsPartition,
    sys::{esp_random, settimeofday, timeval},
    wifi::{BlockingWifi, EspWifi},
};
use matecrew_core::{
    contract::{DeviceState, Side, StatusReport, Take},
    queue::Queue,
    time,
};
use matecrew_ui as ui;
use std::{
    sync::mpsc::{self, Receiver, RecvTimeoutError, TryRecvError},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use api::{Api, LinkPoll, ScreenUpdate};
use buzzer::{Beep, Buzzer};
use display::{Pins, Screen};
use nfc::Nfc;
use store::Store;
use wifi::Wifi;

const FIRMWARE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Failed connections in a row before the device forgets the network and opens setup again.
const MAX_WIFI_FAILURES: u8 = 3;
/// Until deep sleep is wired, the device stays awake and syncs on a timer.
const SYNC_EVERY: Duration = Duration::from_secs(120);
/// How long the terminal waits for a badge after a key press.
const BADGE_WAIT: Duration = Duration::from_secs(15);
/// Seconds to cancel a take before it counts.
const UNDO_SECONDS: u32 = 10;
/// Before this (November 2023) the clock has not been set by a sync yet.
const CLOCK_SET_AFTER: i64 = 1_700_000_000;

/// What the keys, the console and the NFC reader report to the main loop.
pub enum Event {
    Key(Side),
    Badge(String),
    Sync,
}

fn main() -> Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();
    log::info!("matecrew device {FIRMWARE_VERSION}, site {}", api::BASE_URL);

    let p = Peripherals::take()?;
    let sys_loop = EspSystemEventLoop::take()?;
    let nvs = EspDefaultNvsPartition::take()?;
    let store = Store::new(nvs.clone())?;
    let mut screen = Screen::new(Pins {
        spi: p.spi2,
        sck: p.pins.gpio7,
        mosi: p.pins.gpio9,
        cs: p.pins.gpio2,
        busy: p.pins.gpio3,
        dc: p.pins.gpio4,
        rst: p.pins.gpio1,
    })?;

    let (sender, events) = mpsc::channel();
    if let Err(e) = console::watch(sender.clone()) {
        log::warn!("no serial console commands: {e:#}");
    }
    keys::watch(p.pins.gpio5, p.pins.gpio8, sender)?;
    let buzzer = Buzzer::new(p.ledc.timer0, p.ledc.channel0, p.pins.gpio44)?;
    let nfc = match Nfc::new(p.i2c0, p.pins.gpio41, p.pins.gpio42) {
        Ok(nfc) => Some(nfc),
        Err(e) => {
            log::warn!("no NFC reader ({e:#}): badges come from the console, `b <uid>`");
            None
        }
    };

    let mut wifi = BlockingWifi::wrap(EspWifi::new(p.modem, sys_loop.clone(), Some(nvs))?, sys_loop)?;
    let Some(creds) = store.wifi()? else {
        setup_wifi(&mut wifi, &mut screen, &store)?;
        reset::restart();
    };

    if let Err(e) = wifi::connect(&mut wifi, &creds) {
        let failures = store.wifi_failures()?.saturating_add(1);
        log::warn!("Wi-Fi {:?} failed ({failures}/{MAX_WIFI_FAILURES}): {e:#}", creds.ssid);
        let detail = if failures >= MAX_WIFI_FAILURES {
            store.clear_wifi()?;
            store.set_wifi_failures(0)?;
            "Le réseau est oublié : le QR de configuration revient dans une minute.".to_owned()
        } else {
            store.set_wifi_failures(failures)?;
            format!("« {} » ne répond pas. Nouvel essai dans une minute.", creds.ssid)
        };
        screen.show(|d| ui::error_screen(d, "Wi-Fi introuvable", &detail))?;
        thread::sleep(Duration::from_secs(60));
        reset::restart();
    }
    store.set_wifi_failures(0)?;

    let token = match store.token()? {
        Some(token) => token,
        None => link(&wifi, &mut screen, &store)?,
    };

    Terminal {
        api: Api::with_token(token),
        state: store.state()?,
        queue: store.queue()?,
        wifi,
        screen,
        store,
        buzzer,
        nfc,
        events,
    }
    .run()
}

/// Opens the setup access point, shows its QR and waits for the phone to send the office Wi-Fi.
fn setup_wifi(wifi: &mut Wifi, screen: &mut Screen, store: &Store) -> Result<()> {
    let ap = wifi::start_setup_access_point(wifi)?;
    log::info!("setup access point {} at {}", ap.ssid, ap.ip);
    let portal_url = format!("http://{}", ap.ip);
    screen.show(|d| {
        ui::setup_screen(
            d,
            &ui::SetupInfo { ap_ssid: &ap.ssid, ap_password: &ap.password, portal_url: &portal_url },
        )
    })?;

    let (saved, received) = mpsc::channel();
    let _server = portal::serve(ap.ip.parse()?, ap.networks, saved)?;
    let creds = received.recv()?;
    log::info!("Wi-Fi {:?} saved", creds.ssid);
    store.set_wifi(&creds)?;
    // Let the confirmation page reach the phone before the access point goes away.
    thread::sleep(Duration::from_secs(3));
    Ok(())
}

/// Shows a code until an office admin approves it on the site, then keeps the token.
fn link(wifi: &Wifi, screen: &mut Screen, store: &Store) -> Result<String> {
    let hardware_id = wifi::hardware_id(wifi)?;
    let api = Api::anonymous();
    loop {
        let start = api.link_start(&hardware_id)?;
        log::info!("link code {}", start.user_code);
        let short_url = start
            .verification_uri
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        screen.show(|d| {
            ui::link_screen(
                d,
                &ui::LinkInfo {
                    code: &start.user_code,
                    url: short_url,
                    url_with_code: &start.verification_uri_complete,
                },
            )
        })?;

        let deadline = Instant::now() + Duration::from_secs(start.expires_in);
        let mut interval = start.interval.max(1);
        while Instant::now() < deadline {
            thread::sleep(Duration::from_secs(interval));
            match api.link_poll(&start.device_code) {
                Ok(LinkPoll::Granted(granted)) => {
                    store.set_token(&granted.access_token)?;
                    log::info!("linked to {} as {}", granted.office_name, granted.device_name);
                    screen.show(|d| ui::linked_screen(d, &granted.office_name, &granted.device_name))?;
                    thread::sleep(Duration::from_secs(5));
                    return Ok(granted.access_token);
                }
                Ok(LinkPoll::Pending) => {}
                Ok(LinkPoll::SlowDown) => interval += 5,
                Ok(LinkPoll::Restart) => break,
                Err(e) => log::warn!("link poll failed: {e:#}"),
            }
        }
    }
}

/// A linked terminal: waits for a key, takes a badge, and syncs.
struct Terminal {
    api: Api,
    wifi: Wifi,
    screen: Screen,
    store: Store,
    buzzer: Buzzer,
    nfc: Option<Nfc>,
    events: Receiver<Event>,
    /// From the last sync, or from NVS until the first one succeeds.
    state: Option<DeviceState>,
    queue: Queue,
}

impl Terminal {
    fn run(mut self) -> Result<()> {
        // Keys touched during setup or linking do not count.
        while self.events.try_recv().is_ok() {}
        let mut redraw = false;
        loop {
            match self.sync(redraw) {
                Ok(()) => {}
                Err(e) if e.is::<api::Unauthorized>() => {
                    log::warn!("the site unlinked this device, linking again");
                    self.store.clear_token()?;
                    reset::restart();
                }
                Err(e) => log::error!("sync failed: {e:#}"),
            }
            // After a take the main screen must come back, even if the site's is unchanged.
            redraw = match self.wait(SYNC_EVERY)? {
                Some(side) => {
                    self.take(side)?;
                    true
                }
                None => false,
            };
        }
    }

    /// Waits for a key, a sync request or the timeout.
    fn wait(&mut self, timeout: Duration) -> Result<Option<Side>> {
        let deadline = Instant::now() + timeout;
        loop {
            match self.events.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(Event::Key(side)) => return Ok(Some(side)),
                Ok(Event::Sync) | Err(RecvTimeoutError::Timeout) => return Ok(None),
                Ok(Event::Badge(uid)) => log::info!("badge {uid} with no key touched before: ignored"),
                Err(RecvTimeoutError::Disconnected) => bail!("the keys stopped reporting"),
            }
        }
    }

    /// Key, badge, a few seconds to cancel, then the take joins the queue.
    fn take(&mut self, side: Side) -> Result<()> {
        let Some(state) = self.state.clone().filter(|_| now() > CLOCK_SET_AFTER) else {
            self.buzzer.beep(Beep::Error);
            self.screen.show(|d| {
                ui::error_screen(d, "Pas encore prêt", "Le terminal attend sa première synchro avec le site.")
            })?;
            thread::sleep(Duration::from_secs(4));
            return Ok(());
        };
        let key = state.key(side);
        self.buzzer.beep(Beep::Key);
        self.screen.show(|d| ui::badge_screen(d, &key.label))?;

        let Some(uid) = self.wait_badge()? else {
            log::info!("no badge, take cancelled");
            return Ok(());
        };
        let Some(name) = state.badge_holder(&uid) else {
            log::info!("unknown badge {uid}");
            self.buzzer.beep(Beep::Error);
            self.queue.note_unknown_badge(&uid);
            self.save_queue();
            self.screen.show(|d| ui::unknown_badge_screen(d, &uid))?;
            thread::sleep(Duration::from_secs(5));
            return Ok(());
        };

        self.buzzer.beep(Beep::Accepted);
        let info = ui::TakeInfo { name, key_label: &key.label, seconds: UNDO_SECONDS };
        self.screen.show(|d| ui::take_screen(d, &info))?;
        if !self.confirm()? {
            log::info!("{name} cancelled");
            self.buzzer.beep(Beep::Key);
            return Ok(());
        }

        let take = Take {
            id: format!("{:08x}{:08x}", unsafe { esp_random() }, unsafe { esp_random() }),
            badge_uid: uid,
            action: key.action,
            item_id: key.item_id.clone(),
            at: time::format_iso(now()),
        };
        log::info!("{name}: {} queued", key.label);
        if let Some(dropped) = self.queue.push(take) {
            log::warn!("queue full, oldest take {} dropped", dropped.id);
        }
        self.save_queue();
        Ok(())
    }

    /// A badge from the reader or the console; `None` after a key press or the timeout.
    fn wait_badge(&mut self) -> Result<Option<String>> {
        let deadline = Instant::now() + BADGE_WAIT;
        while Instant::now() < deadline {
            match self.events.try_recv() {
                Ok(Event::Badge(uid)) => return Ok(Some(uid)),
                Ok(Event::Key(_)) => return Ok(None),
                Ok(Event::Sync) | Err(TryRecvError::Empty) => {}
                Err(TryRecvError::Disconnected) => bail!("the keys stopped reporting"),
            }
            if let Some(nfc) = &mut self.nfc {
                match nfc.read_uid() {
                    Ok(Some(uid)) => return Ok(Some(uid)),
                    Ok(None) => {}
                    Err(e) => log::warn!("NFC: {e:#}"),
                }
            }
            thread::sleep(Duration::from_millis(150));
        }
        Ok(None)
    }

    /// Left key confirms, right key cancels, silence confirms.
    fn confirm(&mut self) -> Result<bool> {
        let deadline = Instant::now() + Duration::from_secs(UNDO_SECONDS.into());
        loop {
            match self.events.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(Event::Key(Side::Left)) | Err(RecvTimeoutError::Timeout) => return Ok(true),
                Ok(Event::Key(Side::Right)) => return Ok(false),
                Ok(_) => {}
                Err(RecvTimeoutError::Disconnected) => bail!("the keys stopped reporting"),
            }
        }
    }

    /// Sends the queued takes and unknown badges, then fetches the state and the screen.
    fn sync(&mut self, redraw: bool) -> Result<()> {
        wifi::reconnect(&mut self.wifi)?;
        if !self.queue.takes().is_empty() {
            let reply = self.api.takes(self.queue.takes())?;
            for rejected in &reply.rejected {
                log::warn!("take {} rejected: {}", rejected.id, rejected.reason);
            }
            self.queue.settle(&reply.done);
            self.save_queue();
            log::info!("{} takes sent, {} left", reply.done.len(), self.queue.takes().len());
        }

        let state = self.api.state()?;
        set_clock(&state.server_time);
        log::info!("{} ({}), {} badges", state.device.name, state.office.name, state.badges.len());
        self.store.set_state(&state)?;
        self.state = Some(state);

        self.api.status(&StatusReport {
            firmware_version: FIRMWARE_VERSION,
            battery_mv: None,
            wifi_rssi: wifi::rssi(),
            unknown_badges: self.queue.unknown_badges(),
        })?;
        if !self.queue.unknown_badges().is_empty() {
            self.queue.clear_unknown_badges();
            self.save_queue();
        }

        let etag = if redraw { None } else { self.store.screen_etag()? };
        match self.api.screen(etag.as_deref())? {
            ScreenUpdate::Unchanged => log::info!("screen unchanged"),
            ScreenUpdate::Changed { bits, etag } => {
                self.screen.show_bits(&bits)?;
                if let Some(etag) = etag {
                    self.store.set_screen_etag(&etag)?;
                }
            }
        }
        Ok(())
    }

    fn save_queue(&self) {
        if let Err(e) = self.store.set_queue(&self.queue) {
            log::error!("queue not saved: {e:#}");
        }
    }
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// The site's clock is the reference: takes are stamped with it.
fn set_clock(server_time: &str) {
    if let Some(seconds) = time::parse_iso(server_time) {
        let tv = timeval { tv_sec: seconds as _, tv_usec: 0 };
        // SAFETY: plain call with a valid timeval and no timezone.
        unsafe { settimeofday(&tv, std::ptr::null()) };
    }
}
