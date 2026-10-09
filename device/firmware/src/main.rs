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
mod remote;
mod store;
mod wifi;

use anyhow::{bail, Result};
use core::convert::Infallible;
use esp_idf_svc::{
    eventloop::EspSystemEventLoop,
    hal::{peripherals::Peripherals, reset},
    nvs::EspDefaultNvsPartition,
    sys::{esp_random, settimeofday, timeval},
    wifi::{BlockingWifi, EspWifi},
};
use matecrew_core::{
    contract::{DeviceState, StatusReport},
    flow::{Context, Effect, Event, Flow, Screen},
    queue::Queue,
    time,
};
use matecrew_ui as ui;
use std::{
    sync::mpsc::{self, Receiver, RecvTimeoutError, Sender},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use api::{Api, LinkPoll, ScreenUpdate};
use buzzer::Buzzer;
use display::{Canvas, Pins, Screen as Panel};
use nfc::Nfc;
use store::Store;
use wifi::Wifi;

const FIRMWARE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Failed connections in a row before the device forgets the network and opens setup again.
const MAX_WIFI_FAILURES: u8 = 3;
/// Until deep sleep is wired, the device stays awake and syncs on a timer.
const SYNC_EVERY: Duration = Duration::from_secs(120);
/// How often the NFC reader is asked for a badge while the flow waits for one.
const BADGE_POLL: Duration = Duration::from_millis(150);
/// Before this (November 2023) the clock has not been set by a sync yet.
const CLOCK_SET_AFTER: i64 = 1_700_000_000;

/// What the keys, the serial console and the site's console send the main loop.
pub enum Input {
    Flow(Event),
    Sync,
    Restart,
    ForgetWifi,
}

fn main() -> Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();
    log::info!("matecrew device {FIRMWARE_VERSION}, site {}", api::BASE_URL);

    let p = Peripherals::take()?;
    let sys_loop = EspSystemEventLoop::take()?;
    let nvs = EspDefaultNvsPartition::take()?;
    let store = Store::new(nvs.clone())?;
    let mut screen = Panel::new(Pins {
        spi: p.spi2,
        sck: p.pins.gpio7,
        mosi: p.pins.gpio9,
        cs: p.pins.gpio2,
        busy: p.pins.gpio3,
        dc: p.pins.gpio4,
        rst: p.pins.gpio1,
    })?;

    let (sender, inputs) = mpsc::channel();
    if let Err(e) = console::watch(sender.clone()) {
        log::warn!("no serial console commands: {e:#}");
    }
    keys::watch(p.pins.gpio5, p.pins.gpio8, sender.clone())?;
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

    let api = Api::with_token(token);
    remote::poll_commands(api.clone(), sender.clone())?;
    Terminal {
        mirror: remote::Mirror::start(api.clone())?,
        api,
        state: store.state()?,
        queue: store.queue()?,
        flow: Flow::new(),
        started: Instant::now(),
        main_screen: None,
        wifi,
        screen,
        store,
        buzzer,
        nfc,
        inputs,
        _sender: sender,
    }
    .run()
}

/// Opens the setup access point, shows its QR and waits for the phone to send the office Wi-Fi.
fn setup_wifi(wifi: &mut Wifi, screen: &mut Panel, store: &Store) -> Result<()> {
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
fn link(wifi: &Wifi, screen: &mut Panel, store: &Store) -> Result<String> {
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

/// A linked terminal: runs the take flow on the inputs, and syncs.
struct Terminal {
    api: Api,
    mirror: remote::Mirror,
    wifi: Wifi,
    screen: Panel,
    store: Store,
    buzzer: Buzzer,
    nfc: Option<Nfc>,
    inputs: Receiver<Input>,
    /// Keeps the channel open even if every input thread stops.
    _sender: Sender<Input>,
    flow: Flow,
    /// Origin of the flow's milliseconds.
    started: Instant,
    /// From the last sync, or from NVS until the first one succeeds.
    state: Option<DeviceState>,
    queue: Queue,
    /// The site's last screen, to come back to without the network.
    main_screen: Option<Vec<u8>>,
}

enum Next {
    Input(Input),
    /// The flow's deadline passed.
    Tick,
    /// Idle, and time to sync.
    SyncDue,
}

impl Terminal {
    fn run(mut self) -> Result<()> {
        // Keys touched during setup or linking do not count.
        while self.inputs.try_recv().is_ok() {}
        self.sync(false);
        let mut sync_at = Instant::now() + SYNC_EVERY;
        loop {
            match self.next(sync_at)? {
                Next::Input(Input::Flow(event)) => self.step(event)?,
                Next::Tick => self.step(Event::Tick)?,
                Next::Input(Input::Sync) | Next::SyncDue => {
                    if self.flow.is_idle() {
                        self.sync(false);
                        sync_at = Instant::now() + SYNC_EVERY;
                    }
                }
                Next::Input(Input::Restart) => {
                    log::info!("restart asked from the site");
                    reset::restart();
                }
                Next::Input(Input::ForgetWifi) => {
                    log::info!("the site asked to forget the Wi-Fi");
                    self.store.clear_wifi()?;
                    reset::restart();
                }
            }
        }
    }

    /// Waits for an input, the flow's deadline or the sync, and reads badges meanwhile.
    fn next(&mut self, sync_at: Instant) -> Result<Next> {
        loop {
            let deadline = self.flow.deadline().map_or(sync_at, |ms| self.started + Duration::from_millis(ms));
            let now = Instant::now();
            if now >= deadline {
                return Ok(if self.flow.is_idle() { Next::SyncDue } else { Next::Tick });
            }
            let wait = if self.flow.wants_badge() { BADGE_POLL.min(deadline - now) } else { deadline - now };
            match self.inputs.recv_timeout(wait) {
                Ok(input) => return Ok(Next::Input(input)),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => bail!("every input stopped"),
            }
            if let (true, Some(nfc)) = (self.flow.wants_badge(), &mut self.nfc) {
                match nfc.read_uid() {
                    Ok(Some(uid)) => return Ok(Next::Input(Input::Flow(Event::Badge { uid }))),
                    Ok(None) => {}
                    Err(e) => log::warn!("NFC: {e:#}"),
                }
            }
        }
    }

    fn step(&mut self, event: Event) -> Result<()> {
        let cx = Context {
            now_ms: self.started.elapsed().as_millis() as u64,
            unix: Some(now()).filter(|t| *t > CLOCK_SET_AFTER),
            state: self.state.as_ref(),
            random: (u64::from(unsafe { esp_random() }) << 32) | u64::from(unsafe { esp_random() }),
        };
        for effect in self.flow.handle(event, cx) {
            match effect {
                Effect::Beep { beep } => self.buzzer.beep(beep),
                Effect::Queue { take } => {
                    log::info!("take {} queued for {}", take.id, take.badge_uid);
                    if let Some(dropped) = self.queue.push(take) {
                        log::warn!("queue full, oldest take {} dropped", dropped.id);
                    }
                    self.save_queue();
                }
                Effect::NoteUnknownBadge { uid } => {
                    log::info!("unknown badge {uid}");
                    self.queue.note_unknown_badge(&uid);
                    self.save_queue();
                }
                Effect::Show { screen: Screen::Main } => self.show_main()?,
                Effect::Show { screen } => self.show(|d| ui::flow_screen(d, &screen))?,
            }
        }
        Ok(())
    }

    /// Back to the site's screen: fetched again if takes are waiting, else the last one.
    fn show_main(&mut self) -> Result<()> {
        if self.queue.takes().is_empty() {
            if let Some(bits) = self.main_screen.take() {
                let shown = self.show_bits(&bits);
                self.main_screen = Some(bits);
                return shown;
            }
        }
        if !self.sync(true) {
            if let Some(bits) = self.main_screen.take() {
                let shown = self.show_bits(&bits);
                self.main_screen = Some(bits);
                return shown;
            }
        }
        Ok(())
    }

    fn show(&mut self, draw: impl FnOnce(&mut Canvas) -> Result<(), Infallible>) -> Result<()> {
        self.screen.show(draw)?;
        self.mirror.send(self.screen.frame());
        Ok(())
    }

    fn show_bits(&mut self, bits: &[u8]) -> Result<()> {
        self.screen.show_bits(bits)?;
        self.mirror.send(self.screen.frame());
        Ok(())
    }

    /// Syncs and says whether it worked. A device the site no longer knows links again.
    fn sync(&mut self, redraw: bool) -> bool {
        match self.try_sync(redraw) {
            Ok(()) => true,
            Err(e) if e.is::<api::Unauthorized>() => {
                log::warn!("the site unlinked this device, linking again");
                let _ = self.store.clear_token();
                reset::restart();
            }
            Err(e) => {
                log::error!("sync failed: {e:#}");
                false
            }
        }
    }

    /// Sends the queued takes and unknown badges, then fetches the state and the screen.
    fn try_sync(&mut self, redraw: bool) -> Result<()> {
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

        let etag = if redraw || self.main_screen.is_none() { None } else { self.store.screen_etag()? };
        match self.api.screen(etag.as_deref())? {
            ScreenUpdate::Unchanged => log::info!("screen unchanged"),
            ScreenUpdate::Changed { bits, etag } => {
                self.show_bits(&bits)?;
                self.main_screen = Some(bits);
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
