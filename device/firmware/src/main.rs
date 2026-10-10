//! matécrew badge terminal: Wi-Fi setup by QR, linking with a code shown on
//! the panel, takes with a key and a badge, and syncs that send the takes and
//! draw every screen locally from the site’s data.

mod api;
mod ble;
mod buzzer;
mod cores;
mod fetch;
mod console;
mod display;
mod epd;
mod keys;
mod net;
mod nfc;
mod ota;
mod portal;
mod power;
mod remote;
mod store;
mod wifi;

use anyhow::{bail, Result};
use core::convert::Infallible;
use esp_idf_svc::{
    eventloop::EspSystemEventLoop,
    hal::{cpu::Core, gpio::Gpio6, peripherals::Peripherals, reset},
    nvs::EspDefaultNvsPartition,
    sntp::{EspSntp, SntpConf},
    sys::{esp_random, settimeofday, timeval},
    wifi::{BlockingWifi, EspWifi},
};
use matecrew_core::{
    claim::{self, Claim},
    contract::{DeviceState, ServeRequest, StatusReport},
    flow::{Context, Effect, Event, Flow, Screen},
    queue::Queue,
    time,
};
use matecrew_ui as ui;
use std::{
    collections::VecDeque,
    sync::mpsc::{self, Receiver, RecvTimeoutError, Sender},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use api::{Api, LinkPoll};
use buzzer::Buzzer;
use display::{Canvas, Pins, Screen as Panel};
use nfc::Nfc;
use store::Store;
use wifi::Wifi;

const FIRMWARE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// When (UTC) and from which commit this firmware was built (build.rs), for the about page.
const FIRMWARE_BUILD: &str = env!("MATECREW_BUILD");
const FIRMWARE_COMMIT: &str = env!("MATECREW_COMMIT");
/// Failed connections in a row before the device forgets the network and opens setup again.
const MAX_WIFI_FAILURES: u8 = 3;
/// Until deep sleep is wired, the device stays awake and syncs on a timer.
const SYNC_EVERY: Duration = Duration::from_secs(120);
/// How soon to try again while the site does not answer.
const OFFLINE_RETRY: Duration = Duration::from_secs(30);
/// How often the NFC reader is asked for a badge while the flow waits for one.
const BADGE_POLL: Duration = Duration::from_millis(150);
/// The reader is also polled while idle, more slowly: a badge put on it shows in a toast.
const IDLE_BADGE_POLL: Duration = Duration::from_millis(400);
/// Before this (November 2023) the clock has not been set by a sync yet.
const CLOCK_SET_AFTER: i64 = 1_700_000_000;

/// What the keys, the serial console and the site's console send the main loop.
pub enum Input {
    Flow(Event),
    SelectApp(matecrew_core::contract::BuiltinApp),
    Tap(i32, i32),
    Notify(String),
    Sync,
    Restart,
    ForgetWifi,
    /// The serial console's `site <url>`: the same site at a new address.
    MoveSite(String),
    /// An app's data or image, from the fetching thread.
    Fetched(fetch::Fetched),
    /// A badge put on the reader while nobody asked for one.
    BadgeSeen(String),
    /// A touch key, already beeped by the keys thread the moment it was touched.
    Pressed(Event),
    /// A transfer with the site started or ended: the status bar's arrows may change.
    Net,
}

/// Failed attempts to reach the site, 30 s apart, before an unlinked terminal goes back to setup.
const MAX_SITE_FAILURES: u32 = 10;
/// How long an error stays on screen before the terminal starts over.
const RETRY_AFTER: Duration = Duration::from_secs(30);
/// The panel's ghosting is cleared (a flash) only after this long without a key or a tap.
const CLEAN_WHEN_IDLE: Duration = Duration::from_secs(60);
/// A sync waits this long after the last key or tap: it holds the keys while the site answers,
/// up to `api::TIMEOUT` when it does not.
const SYNC_WHEN_IDLE: Duration = Duration::from_secs(30);

fn main() {
    // The terminal has no button and no switch: whatever fails, it starts over
    // rather than stopping on a frozen screen.
    if let Err(e) = app() {
        log::error!("{e:#}; restarting in {RETRY_AFTER:?}");
        thread::sleep(RETRY_AFTER);
    }
    reset::restart();
}

fn app() -> Result<()> {
    esp_idf_svc::sys::link_patches();
    // The log goes to the serial port and to a browser paired over Bluetooth.
    ble::init_logging();
    log::info!("matecrew device {FIRMWARE_VERSION}");

    let p = Peripherals::take()?;
    let sys_loop = EspSystemEventLoop::take()?;
    let nvs = EspDefaultNvsPartition::take()?;
    let store = Store::new(nvs.clone())?;
    ota::check_boot(&store)?;
    store.pin_site(api::DEFAULT_SITE)?;
    // The panel's task shares core 1 with the screen loop.
    let mut screen = cores::on(Core::Core1, || {
        Panel::new(Pins {
            spi: p.spi2,
            sck: p.pins.gpio7,
            mosi: p.pins.gpio9,
            cs: p.pins.gpio2,
            busy: p.pins.gpio3,
            dc: p.pins.gpio4,
            rst: p.pins.gpio1,
        })
    })?;

    let (sender, inputs) = mpsc::channel();
    net::watch(sender.clone());
    // The start, live: each step on the boot screen as it goes (`ui::boot::BootLog`).
    let mut boot = ui::boot::BootLog::new(6);
    // Words come from the boot screen's catalog, in the office's language (cached state).
    if let Ok(Some(state)) = store.state() {
        ui::set_locale(&state.office.locale);
    }
    boot.start("screen", &[]);
    boot.done("screenReady", &[]);
    boot.start("reader", &[]);
    screen.show(|d| boot.render(d))?;
    if let Err(e) = console::watch(sender.clone()) {
        log::warn!("no serial console commands: {e:#}");
    }
    // SAFETY: the buzzer drives D5 only while it beeps, between battery readings (`Supply`
    // waits for it to be quiet).
    let buzzer = cores::on(Core::Core1, || {
        Buzzer::start(p.ledc.timer0, p.ledc.channel0, unsafe { Gpio6::steal() })
    })?;
    buzzer.beep(matecrew_core::flow::Beep::Boot);
    cores::on(Core::Core1, || {
        keys::watch(p.pins.gpio5, p.pins.gpio8, sender.clone(), buzzer.clone())
    })?;
    // D5 (GPIO 6): half the battery voltage, and the piezo. Without the ADC the status bar says "--".
    let battery = (|| -> Result<_> {
        use esp_idf_svc::hal::adc::{
            attenuation::DB_12,
            oneshot::{
                config::{AdcChannelConfig, Calibration},
                AdcChannelDriver, AdcDriver,
            },
        };
        let config = AdcChannelConfig {
            attenuation: DB_12,
            calibration: Calibration::Curve,
            ..Default::default()
        };
        Ok(AdcChannelDriver::new(AdcDriver::new(p.adc1)?, p.pins.gpio6, &config)?)
    })();
    let supply = power::Supply::new(match battery {
        Ok(mut channel) => Box::new(move || channel.read().ok()),
        Err(e) => {
            log::warn!("no battery reading ({e:#})");
            Box::new(|| None)
        }
    });
    let nfc = match Nfc::new(p.i2c0, p.pins.gpio43, p.pins.gpio44) {
        Ok(nfc) => Some(nfc),
        Err(e) => {
            log::warn!("no NFC reader ({e:#}): badges come from the console, `b <uid>`");
            nfc::diagnose();
            None
        }
    };
    match &nfc {
        Some(nfc) => boot.done("readerReady", &[("version", nfc.version())]),
        None => boot.fail("readerMissing", &[]),
    }

    let mut wifi = BlockingWifi::wrap(
        EspWifi::new(p.modem, sys_loop.clone(), Some(nvs.clone()))?,
        sys_loop,
    )?;
    // Bluetooth LE: setup, control and updates from a browser nearby.
    let ble = start_ble(&wifi, Store::new(nvs)?, sender.clone());
    let bluetooth = ble.as_ref().map(ble::Ble::label).unwrap_or_default();
    let site = store
        .site()?
        .unwrap_or_else(|| api::DEFAULT_SITE.to_owned());
    log::info!("site {site}");
    let Some(creds) = store.wifi()? else {
        setup_wifi(&mut wifi, &mut screen, &store, &site, &bluetooth)?;
        reset::restart();
    };

    let linked = store.token()?.is_some();
    boot.start("wifiJoining", &[("ssid", &creds.ssid)]);
    screen.show(|d| boot.render(d))?;
    if !linked {
        // Setting up: say what happens at each step.
        screen.show(|d| ui::connecting_screen(d, &creds.ssid))?;
    }
    if let Err(e) = wifi::connect(&mut wifi, &creds) {
        if linked {
            // A paired terminal must still boot and accept badges using cached state.
            log::warn!("Wi-Fi unavailable, starting from cached state: {e:#}");
            boot.fail("wifiOffline", &[]);
        } else {
            let failures = store.wifi_failures()?.saturating_add(1);
            log::warn!(
                "Wi-Fi {:?} failed ({failures}/{MAX_WIFI_FAILURES}): {e:#}",
                creds.ssid
            );
            let detail = if failures >= MAX_WIFI_FAILURES {
                store.clear_wifi()?;
                store.set_wifi_failures(0)?;
                "Le réseau est oublié : le QR de configuration revient dans une minute.".to_owned()
            } else {
                store.set_wifi_failures(failures)?;
                format!(
                    "« {} » ne répond pas. Nouvel essai dans une minute.",
                    creds.ssid
                )
            };
            screen.show(|d| ui::error_screen(d, "Wi-Fi introuvable", &detail))?;
            thread::sleep(Duration::from_secs(60));
            reset::restart();
        }
    } else {
        store.set_wifi_failures(0)?;
        match wifi::rssi() {
            Some(rssi) => boot.done("wifiJoined", &[("ssid", &creds.ssid), ("rssi", &rssi.to_string())]),
            None => boot.done("wifiJoinedQuiet", &[("ssid", &creds.ssid)]),
        }
    }
    // The clock from the internet (NTP, every hour), whether the site answers or not: the status
    // bar and the takes' times are right after a restart. A sync with the site sets it too.
    let sntp = cores::on(Core::Core0, || {
        EspSntp::new_with_callback(&SntpConf::default(), |since_epoch| {
            net::pulse(false);
            log::info!("clock set by NTP: {} s since 1970", since_epoch.as_secs())
        })
    })
    .inspect_err(|e| log::warn!("no NTP clock: {e}"))
    .ok();
    if !linked {
        let ip = wifi.wifi().sta_netif().get_ip_info()?.ip.to_string();
        screen.show(|d| ui::connected_screen(d, &creds.ssid, &ip))?;
    }

    let token = match store.token()? {
        Some(token) => token,
        None => link(&wifi, &mut screen, &store, &site, &bluetooth)?,
    };

    let claim_key = claim::key(&token);
    boot.start("site", &[]);
    boot.done("siteReady", &[("host", api::host(&site))]);
    boot.start("apps", &[]);
    screen.show(|d| boot.render(d))?;
    let api = Api::with_token(&site, token);
    let mirror = cores::on(Core::Core0, || remote::Mirror::start(api.clone()))?;
    cores::on(Core::Core0, || remote::poll_commands(api.clone(), sender.clone(), mirror.clone()))?;
    let state = store.state()?;
    let mode = store.app_mode()?;
    let mut app = state
        .as_ref()
        .and_then(|s| s.app_url.as_deref())
        .and_then(|url| store.app(url).ok().flatten())
        .and_then(|bytes| ui::engine::Scene::from_bytecode(&bytes).ok())
        .and_then(|scene| ui::engine::Runtime::new(scene).ok());
    if mode == Some(matecrew_core::contract::BuiltinApp::Showcase) {
        ui::release_screen_cache();
        app = Some(ui::apps::showcase().map_err(anyhow::Error::msg)?);
    }
    if mode == Some(matecrew_core::contract::BuiltinApp::Mate) {
        app = None;
    }
    if let Some(app) = &mut app {
        let cache = if mode == Some(matecrew_core::contract::BuiltinApp::Showcase) {
            store.showcase_data()?
        } else {
            store.app_data()?
        };
        if let Some(cache) = cache {
            app.restore(&cache);
        }
        if let Some(state) = &state {
            app.update("showcase", serde_json::to_value(state)?);
        }
    }
    boot.done(if app.is_some() { "appsLoaded" } else { "mateLoaded" }, &[]);
    boot.start("ready", &[]);
    boot.done("allReady", &[]);
    screen.show(|d| boot.render(d))?;
    Terminal {
        site: site.clone(),
        claim_key,
        mirror,
        fetcher: cores::on(Core::Core0, || fetch::Fetcher::start(api.clone(), sender.clone()))?,
        _sntp: sntp,
        _ble: ble,
        bluetooth,
        badge_on_reader: None,
        pressed: false,
        net_drawn: (false, false),
        pending: VecDeque::new(),
        dirty: false,
        api,
        state,
        app,
        app_mode: mode,
        pending_app: None,
        queue: store.queue()?,
        flow: Flow::new(),
        last_flow_screen: None,
        started: Instant::now(),
        wifi,
        ssid: creds.ssid.clone(),
        rssi: None,
        supply,
        slot: ota::running_slot(),
        screen,
        store,
        buzzer,
        nfc,
        inputs,
        _sender: sender,
        confirmed: false,
        offline: false,
    }
    .run()
}

/// The factory base MAC burnt in eFuse, in hex: Espressif's unique id for the chip.
fn chip_id() -> Option<String> {
    let mut mac = [0u8; 6];
    // SAFETY: writes the six bytes of the base MAC into `mac`.
    let ok = unsafe { esp_idf_svc::sys::esp_efuse_mac_get_default(mac.as_mut_ptr()) } == 0;
    ok.then(|| mac.iter().map(|b| format!("{b:02X}")).collect())
}

/// Starts the Bluetooth link, named after the end of the Wi-Fi MAC like the setup access point.
/// The terminal works without it.
fn start_ble(wifi: &Wifi, store: Store, inputs: Sender<Input>) -> Option<ble::Ble> {
    let started = (|| -> Result<ble::Ble> {
        let hardware_id = wifi::hardware_id(wifi)?;
        let suffix: String = hardware_id.split(':').skip(4).collect();
        let identity = ble::Identity {
            name: format!("matecrew-{suffix}"),
            hardware_id,
            firmware: matecrew_core::link::Firmware {
                version: FIRMWARE_VERSION.into(),
                build: FIRMWARE_BUILD.into(),
                commit: FIRMWARE_COMMIT.into(),
                slot: ota::running_slot(),
            },
        };
        // Its host task and notifier with the Wi-Fi on core 0.
        cores::on(Core::Core0, || ble::start(store, inputs, identity))
    })();
    started.inspect_err(|e| log::warn!("no Bluetooth: {e:#}")).ok()
}

/// Polls with the link secret that came over Bluetooth until the site hands the token over, for
/// as long as such a link lives (10 minutes). `None` when the site refuses it: a code is shown.
fn link_with_secret(api: &Api, store: &Store, screen: &mut Panel, secret: &str) -> Result<Option<String>> {
    log::info!("linking with the secret that came over Bluetooth");
    let deadline = Instant::now() + Duration::from_secs(10 * 60);
    let mut interval = 0;
    while Instant::now() < deadline {
        thread::sleep(Duration::from_secs(interval));
        interval = interval.max(5);
        match api.link_poll(secret) {
            Ok(LinkPoll::Granted(granted)) => {
                store.set_link_secret(None)?;
                store.set_token(&granted.access_token)?;
                log::info!("linked to {} as {}", granted.office_name, granted.device_name);
                screen.show(|d| ui::linked_screen(d, &granted.office_name, &granted.device_name))?;
                thread::sleep(Duration::from_secs(5));
                return Ok(Some(granted.access_token));
            }
            Ok(LinkPoll::Pending) => {}
            Ok(LinkPoll::SlowDown) => interval += 5,
            Ok(LinkPoll::Restart) => break,
            Err(e) => log::warn!("link poll failed: {e:#}"),
        }
    }
    store.set_link_secret(None)?;
    log::warn!("the Bluetooth link secret was refused or expired: showing a code instead");
    Ok(None)
}

/// Opens the setup access point, shows its QR and waits for the phone to send the office Wi-Fi.
/// A browser can send it over Bluetooth meanwhile (`ble.rs` saves it and restarts).
fn setup_wifi(wifi: &mut Wifi, screen: &mut Panel, store: &Store, site: &str, bluetooth: &str) -> Result<()> {
    let ap = wifi::start_setup_access_point(wifi)?;
    log::info!("setup access point {} at {}", ap.ssid, ap.ip);
    ble::set_networks(ap.networks.clone());
    let portal_url = format!("http://{}", ap.ip);
    screen.show(|d| {
        ui::setup_screen(
            d,
            &ui::SetupInfo {
                ap_ssid: &ap.ssid,
                ap_password: &ap.password,
                portal_url: &portal_url,
                bluetooth,
            },
        )
    })?;

    let (saved, received) = mpsc::channel();
    let _server = portal::serve(ap.ip.parse()?, ap.networks, site.to_owned(), saved)?;
    let setup: store::Setup = received.recv()?;
    let creds = setup.wifi;
    log::info!("Wi-Fi {:?} and site {} saved", creds.ssid, setup.site);
    store.set_wifi(&creds)?;
    store.set_site(&setup.site)?;
    // Drawing takes a few seconds: time enough for the confirmation page to
    // reach the phone before the access point goes away. The panel keeps the
    // message through the restart.
    screen.show(|d| ui::connecting_screen(d, &creds.ssid))?;
    Ok(())
}

/// Shows a code until an office admin approves it on the site, then keeps the token. A link the
/// site approved ahead (its secret came over Bluetooth with the Wi-Fi) needs no code.
fn link(wifi: &Wifi, screen: &mut Panel, store: &Store, site: &str, bluetooth: &str) -> Result<String> {
    let hardware_id = wifi::hardware_id(wifi)?;
    let api = Api::anonymous(site);
    if let Some(secret) = store.link_secret()? {
        if let Some(token) = link_with_secret(&api, store, screen, &secret)? {
            return Ok(token);
        }
    }
    let mut failures = 0;
    loop {
        let start = match api.link_start(&hardware_id) {
            Ok(start) => start,
            Err(e) => {
                failures += 1;
                log::warn!("link start failed ({failures}/{MAX_SITE_FAILURES}): {e:#}");
                if failures >= MAX_SITE_FAILURES {
                    // Maybe the wrong site or the wrong network: set up again.
                    store.clear_wifi()?;
                    let detail = format!(
                        "{} ne répond toujours pas. Retour à la configuration du Wi-Fi.",
                        api::host(site)
                    );
                    screen.show(|d| ui::error_screen(d, "Site injoignable", &detail))?;
                    thread::sleep(Duration::from_secs(10));
                    reset::restart();
                }
                if failures == 1 {
                    let detail = format!(
                        "{} ne répond pas. Le terminal réessaie toutes les 30 secondes.",
                        api::host(site)
                    );
                    screen.show(|d| ui::error_screen(d, "Site injoignable", &detail))?;
                }
                thread::sleep(RETRY_AFTER);
                continue;
            }
        };
        failures = 0;
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
                    bluetooth,
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
                    log::info!(
                        "linked to {} as {}",
                        granted.office_name,
                        granted.device_name
                    );
                    screen.show(|d| {
                        ui::linked_screen(d, &granted.office_name, &granted.device_name)
                    })?;
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
    last_flow_screen: Option<Screen>,
    api: Api,
    /// For the links that claim an unknown badge: the site and the token's hash.
    site: String,
    claim_key: [u8; 32],
    mirror: remote::Mirror,
    wifi: Wifi,
    /// The office network, for the about page.
    ssid: String,
    /// The last signal read while connected: the status bar keeps it between reads.
    rssi: Option<i8>,
    supply: power::Supply,
    /// The OTA slot this firmware runs from, read once.
    slot: Option<String>,
    screen: Panel,
    store: Store,
    buzzer: Buzzer,
    nfc: Option<Nfc>,
    inputs: Receiver<Input>,
    /// Keeps the channel open even if every input thread stops.
    _sender: Sender<Input>,
    /// Keeps the NTP clock running.
    _sntp: Option<EspSntp<'static>>,
    /// The Bluetooth link, kept for the life of the terminal.
    _ble: Option<ble::Ble>,
    /// Its name and this boot's passkey, for the about page.
    bluetooth: String,
    fetcher: fetch::Fetcher,
    /// The badge on the reader while idle, toasted once until it is taken away.
    badge_on_reader: Option<String>,
    /// A key press being handled already beeped: the key beep its screen asks for is that one.
    pressed: bool,
    /// The network arrows (up, down) the last drawn screen shows.
    net_drawn: (bool, bool),
    /// Inputs taken off the channel early, to see whether more are waiting.
    pending: VecDeque<Input>,
    /// A screen was skipped because more inputs were waiting: drawn once they are handled.
    dirty: bool,
    flow: Flow,
    /// Origin of the flow's milliseconds.
    started: Instant,
    /// From the last sync, or from NVS until the first one succeeds.
    state: Option<DeviceState>,
    /// An optional generic TSX app; domain flows remain an adapter, not engine code.
    app: Option<ui::engine::Runtime>,
    app_mode: Option<matecrew_core::contract::BuiltinApp>,
    pending_app: Option<matecrew_core::contract::BuiltinApp>,
    queue: Queue,
    /// This firmware has synced since it started: the bootloader keeps it.
    confirmed: bool,
    /// The last sync failed: the main screen says so until one works.
    offline: bool,
}

enum Next {
    OverlayDue,
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
        self.maybe_update();
        let mut touched = Instant::now();
        let mut sync_at = Instant::now()
            + if self.offline {
                OFFLINE_RETRY
            } else {
                SYNC_EVERY
            };
        loop {
            if self.flow.is_idle() {
                if let Some(mode) = self.pending_app.take() {
                    self.select_app(mode)?;
                }
            }
            match self.next(sync_at)? {
                Next::OverlayDue => {
                    if let Some(app) = &mut self.app {
                        app.tick(self.started.elapsed().as_millis() as u64);
                    }
                    ui::notifications::tick(self.started.elapsed().as_millis() as u64);
                    self.redraw_current()?;
                }
                Next::Input(Input::Notify(message)) => {
                    self.buzzer.beep(matecrew_core::flow::Beep::Notification);
                    ui::notifications::notify(
                        &message,
                        5000,
                        self.started.elapsed().as_millis() as u64,
                    );
                    self.redraw_current()?;
                }
                Next::Input(Input::SelectApp(mode)) => {
                    self.pending_app = Some(mode);
                }
                Next::Input(Input::Fetched(fetched)) => self.fetched(fetched)?,
                Next::Input(Input::Net) => {
                    if net::shown() != self.net_drawn {
                        self.redraw_current()?;
                    }
                }
                Next::Input(Input::BadgeSeen(uid)) => {
                    touched = Instant::now();
                    self.badge_seen(&uid)?
                }
                Next::Input(Input::Tap(x, y)) => {
                    touched = Instant::now();
                    self.tap_screen(x, y)?
                }
                Next::Input(Input::Pressed(event)) => {
                    touched = Instant::now();
                    self.pressed = true;
                    let stepped = self.step(event);
                    self.pressed = false;
                    stepped?
                }
                Next::Input(Input::Flow(event)) => {
                    touched = Instant::now();
                    // Keys from the console or the site beep here, the touch keys did already.
                    self.pressed = matches!(event, Event::Key { .. } | Event::BothKeys);
                    if self.pressed {
                        self.buzzer.beep(matecrew_core::flow::Beep::Key);
                    }
                    let stepped = self.step(event);
                    self.pressed = false;
                    stepped?
                }
                Next::Tick => self.step(Event::Tick)?,
                Next::SyncDue if touched.elapsed() < SYNC_WHEN_IDLE => {
                    sync_at = touched + SYNC_WHEN_IDLE;
                }
                Next::Input(Input::Sync) | Next::SyncDue => {
                    if self.flow.is_idle() {
                        self.sync(false);
                        if touched.elapsed() >= CLEAN_WHEN_IDLE {
                            self.screen.clean()?;
                        }
                        self.screen.rest()?;
                        self.maybe_update();
                        sync_at = Instant::now()
                            + if self.offline {
                                OFFLINE_RETRY
                            } else {
                                SYNC_EVERY
                            };
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
                Next::Input(Input::MoveSite(url)) => {
                    log::info!("site moved to {url}, restarting");
                    self.store.move_site(&url)?;
                    reset::restart();
                }
            }
        }
    }

    /// Waits for an input, the flow's deadline or the sync, and reads badges meanwhile.
    fn next(&mut self, sync_at: Instant) -> Result<Next> {
        loop {
            if let Some(input) = self.pending.pop_front() {
                return Ok(Next::Input(input));
            }
            if self.dirty {
                // Every waiting input is handled: show where they led.
                self.dirty = false;
                self.redraw_current()?;
                continue;
            }
            if net::shown() != self.net_drawn {
                return Ok(Next::Input(Input::Net));
            }
            let mut deadline = self
                .flow
                .deadline()
                .map_or(sync_at, |ms| self.started + Duration::from_millis(ms));
            let now = Instant::now();
            if let Some(at) = [
                self.app.as_ref().and_then(|app| app.overlay_deadline()),
                ui::notifications::deadline(),
            ]
            .into_iter()
            .flatten()
            .min()
            {
                let overlay = self.started + Duration::from_millis(at);
                if now >= overlay {
                    return Ok(Next::OverlayDue);
                }
                deadline = deadline.min(overlay);
            }
            if now >= deadline {
                return Ok(if self.flow.is_idle() {
                    Next::SyncDue
                } else {
                    Next::Tick
                });
            }
            let idle_reader = self.flow.is_idle() && self.nfc.is_some();
            let wait = if self.flow.wants_badge() {
                BADGE_POLL.min(deadline - now)
            } else if idle_reader {
                IDLE_BADGE_POLL.min(deadline - now)
            } else {
                deadline - now
            };
            // Wake when the network arrows go out (the top of this loop redraws them).
            let wait = net::hide_at().map_or(wait, |at| wait.min(at.saturating_duration_since(now) + Duration::from_millis(20)));
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
            } else if let (true, Some(nfc)) = (idle_reader, &mut self.nfc) {
                match nfc.read_uid() {
                    Ok(Some(uid)) if self.badge_on_reader.as_ref() != Some(&uid) => {
                        self.badge_on_reader = Some(uid.clone());
                        return Ok(Next::Input(Input::BadgeSeen(uid)));
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => self.badge_on_reader = None,
                    Err(e) => log::warn!("NFC: {e:#}"),
                }
            }
        }
    }

    fn select_app(&mut self, mode: matecrew_core::contract::BuiltinApp) -> Result<()> {
        self.save_app_cache()?;
        self.store.set_app_mode(mode)?;
        self.app_mode = Some(mode);
        self.app = match mode {
            matecrew_core::contract::BuiltinApp::Mate => None,
            matecrew_core::contract::BuiltinApp::Showcase => {
                ui::release_screen_cache();
                let mut app = ui::apps::showcase().map_err(anyhow::Error::msg)?;
                if let Some(cache) = self.store.showcase_data()? {
                    app.restore(&cache);
                }
                if let Some(state) = &self.state {
                    app.update("showcase", serde_json::to_value(state)?);
                }
                Some(app)
            }
        };
        log::info!("app selected: {mode:?}");
        log_heap();
        self.draw_main()
    }

    fn save_app_cache(&self) -> Result<()> {
        if let Some(app) = &self.app {
            if self.app_mode == Some(matecrew_core::contract::BuiltinApp::Showcase) {
                self.store.set_showcase_data(app.data())?;
            } else {
                self.store.set_app_data(app.data())?;
            }
        }
        Ok(())
    }

    fn tap_screen(&mut self, x: i32, y: i32) -> Result<()> {
        if !(0..200).contains(&x) || !(0..120).contains(&y) {
            return Ok(());
        }
        if self.flow.is_idle() {
            if let Some(app) = &mut self.app {
                app.tick(self.started.elapsed().as_millis() as u64);
                let effects = app.press(ui::engine::Point::new(
                    x * app.scene().width as i32 / 200,
                    y * app.scene().height as i32 / 120,
                ));
                return self.app_effects(effects);
            }
        }
        if y >= 104 && (x < 70 || x >= 130) {
            self.step(Event::Key {
                side: if x < 70 {
                    matecrew_core::contract::Side::Left
                } else {
                    matecrew_core::contract::Side::Right
                },
            })?;
        }
        Ok(())
    }

    fn step(&mut self, event: Event) -> Result<()> {
        // Both keys belong to the terminal (its about page), whatever app runs.
        if self.flow.is_idle() && event != Event::BothKeys {
            if let Event::Key { side } = &event {
                if let Some(app) = &mut self.app {
                    app.tick(self.started.elapsed().as_millis() as u64);
                    let (name, x) = if *side == matecrew_core::contract::Side::Left {
                        ("left", ui::KEY_LEFT_X)
                    } else {
                        ("right", ui::KEY_RIGHT_X)
                    };
                    let effects = app.input(name).unwrap_or_else(|| {
                        app.press(ui::engine::Point::new(
                            x * app.scene().width as i32 / 200,
                            113 * app.scene().height as i32 / 120,
                        ))
                    });
                    return self.app_effects(effects);
                }
            }
            if self.app_mode == Some(matecrew_core::contract::BuiltinApp::Showcase) {
                return Ok(());
            }
        }
        self.step_domain(event)
    }

    fn app_effects(&mut self, effects: Vec<ui::engine::Effect>) -> Result<()> {
        let mut domain = None;
        for effect in effects {
            match effect {
                ui::engine::Effect::Emit { name } if name == "take" => {
                    domain = Some(matecrew_core::contract::Side::Left)
                }
                ui::engine::Effect::Emit { name } if name == "summary" => {
                    domain = Some(matecrew_core::contract::Side::Right)
                }
                ui::engine::Effect::Beep { tone } => self.beep(match tone {
                    ui::engine::scene::BeepTone::Key => matecrew_core::flow::Beep::Key,
                    ui::engine::scene::BeepTone::Success => matecrew_core::flow::Beep::Accepted,
                    ui::engine::scene::BeepTone::Error => matecrew_core::flow::Beep::Error,
                    ui::engine::scene::BeepTone::Notification => {
                        matecrew_core::flow::Beep::Notification
                    }
                    ui::engine::scene::BeepTone::Badge => matecrew_core::flow::Beep::Badge,
                }),
                ui::engine::Effect::Fetch { id, path } => {
                    self.fetcher.request(fetch::Job::Data { id, path })
                }
                _ => {}
            }
        }
        if let Some(side) = domain {
            return self.step_domain(Event::Key { side });
        }
        // The images come later, from the fetching thread.
        self.request_images();
        self.save_app_cache()?;
        self.draw_main()
    }

    /// A badge on the reader while nobody asked for one: a toast says whose it is, with the
    /// badge tone, so a badge can be tried at any time.
    fn badge_seen(&mut self, uid: &str) -> Result<()> {
        let name = self.state.as_ref().and_then(|state| state.badge(uid)).map(|badge| badge.name.clone());
        log::info!("badge seen: {}", if name.is_some() { "known" } else { "unknown" });
        self.buzzer.beep(matecrew_core::flow::Beep::Badge);
        let message = match name {
            Some(name) => format!("Badge de {name}"),
            None => format!("Badge inconnu · {uid}"),
        };
        ui::notifications::notify(&message, 4000, self.started.elapsed().as_millis() as u64);
        self.redraw_current()
    }

    fn request_images(&mut self) {
        if let Some(app) = &self.app {
            for request in app.image_requests() {
                self.fetcher.request(fetch::Job::Image(request));
            }
        }
    }

    /// An app's data or image arrived: shown at once on the app's screen.
    fn fetched(&mut self, fetched: fetch::Fetched) -> Result<()> {
        self.fetcher.arrived(&fetched);
        let Some(app) = &mut self.app else { return Ok(()) };
        match fetched {
            fetch::Fetched::Data { id, value: Ok(value), .. } => {
                app.update(&id, value);
            }
            fetch::Fetched::Image { request, bytes: Ok(bytes) } => {
                if let Err(error) = app.update_image(&request, &bytes) {
                    log::warn!("image decode: {error}");
                }
            }
            fetch::Fetched::Data { path, value: Err(e), .. } => {
                log::warn!("app data {path}: {e:#}");
                return Ok(());
            }
            fetch::Fetched::Image { request, bytes: Err(e) } => {
                log::warn!("image {}: {e:#}", request.src);
                return Ok(());
            }
        }
        self.request_images();
        self.save_app_cache()?;
        if self.flow.is_idle() {
            self.draw_main()?;
        }
        Ok(())
    }

    fn step_domain(&mut self, event: Event) -> Result<()> {
        let cx = Context {
            now_ms: self.started.elapsed().as_millis() as u64,
            unix: Some(now()).filter(|t| *t > CLOCK_SET_AFTER),
            state: self.state.as_ref(),
            random: (u64::from(unsafe { esp_random() }) << 32) | u64::from(unsafe { esp_random() }),
            claim: self.state.as_ref().map(|state| Claim {
                site: &self.site,
                device_id: &state.device.id,
                key: &self.claim_key,
            }),
        };
        for effect in self.flow.handle(event, cx) {
            match effect {
                Effect::Beep { beep } => self.beep(beep),
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
                Effect::Serve {
                    uid,
                    name,
                    session_id,
                } => self.serve(&uid, name, session_id.as_deref())?,
                Effect::Show {
                    screen: Screen::Main,
                } => self.show_main()?,
                Effect::Show { screen } => {
                    if screen == Screen::About {
                        // The about page shows the readings as they are now.
                        self.device_info();
                    }
                    self.last_flow_screen = Some(screen.clone());
                    if self.input_waiting() {
                        self.dirty = true;
                    } else {
                        self.show(|d| ui::flow_screen(d, &screen))?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Whether another input is already waiting: then a screen is not worth 1 to 2 s of refresh,
    /// the next input changes it again. Quick presses show only where they lead.
    fn input_waiting(&mut self) -> bool {
        if !self.pending.is_empty() {
            return true;
        }
        match self.inputs.try_recv() {
            Ok(input) => {
                self.pending.push_back(input);
                true
            }
            Err(_) => false,
        }
    }

    fn beep(&mut self, beep: matecrew_core::flow::Beep) {
        if !(self.pressed && beep == matecrew_core::flow::Beep::Key) {
            self.buzzer.beep(beep);
        }
    }

    /// "Servi" and a runner's badge: the site serves the session now, then the main screen
    /// comes back without the preparation (the flow's message stage).
    fn serve(&mut self, uid: &str, name: String, session_id: Option<&str>) -> Result<()> {
        let request = ServeRequest {
            session_id,
            badge_uid: uid,
        };
        match self.api.serve(&request) {
            Ok(reply) if reply.reason.is_none() => {
                log::info!("{name} served {} orders", reply.served);
                self.buzzer.beep(matecrew_core::flow::Beep::Accepted);
                let screen = Screen::Served {
                    name,
                    count: reply.served,
                };
                self.last_flow_screen = Some(screen.clone());
                self.show(|d| ui::flow_screen(d, &screen))?;
                // The next main screen shows the stock without the served preparation.
                self.sync(false);
            }
            Ok(reply) => {
                log::warn!("serve refused: {:?}", reply.reason);
                self.buzzer.beep(matecrew_core::flow::Beep::Error);
                self.show(|d| ui::error_screen(d, "Pas servi", "Ce badge n'est relié à aucun compte."))?;
            }
            Err(e) => {
                log::error!("serve failed: {e:#}");
                self.buzzer.beep(matecrew_core::flow::Beep::Error);
                self.show(|d| ui::error_screen(d, "Pas servi", "Le site ne répond pas : réessaie dans un instant."))?;
            }
        }
        Ok(())
    }

    /// Return to the locally rendered dashboard, synchronizing pending takes when possible.
    fn show_main(&mut self) -> Result<()> {
        if !self.queue.takes().is_empty() && self.sync(true) {
            return Ok(());
        }
        self.draw_main()
    }

    /// `$device` for the screens: board, firmware, network, battery and clock, read now.
    fn device_info(&mut self) -> serde_json::Value {
        log_heap();
        // The arrows this screen shows: the loop redraws when they no longer match.
        self.net_drawn = net::shown();
        if !self.offline {
            self.rssi = wifi::rssi().or(self.rssi);
        }
        let ip = self
            .wifi
            .wifi()
            .sta_netif()
            .get_ip_info()
            .ok()
            .map(|info| info.ip.to_string())
            .filter(|ip| ip != "0.0.0.0");
        let site = self
            .site
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/');
        ui::device_info::set(serde_json::json!({
            "board":{"name":"XIAO ESP32-S3","simulated":false},
            "pins":{"left":5,"right":8,"buzzer":6,"nfcSda":43,"nfcScl":44,"battery":6},
            "firmware":{
                "version":FIRMWARE_VERSION,
                "build":FIRMWARE_BUILD,
                "commit":Some(FIRMWARE_COMMIT).filter(|c| !c.is_empty()),
                "slot":self.slot
            },
            "site":site,
            "device":self.state.as_ref().map(|state| serde_json::json!({"id":state.device.id,"name":state.device.name})),
            "chip":{"model":"ESP32-S3","id":chip_id()},
            "bluetooth":self.bluetooth,
            "wifi":{
                "rssi":if self.offline { None } else { self.rssi },
                "ssid":self.ssid,
                "ip":ip,
                "mac":wifi::hardware_id(&self.wifi).ok()
            },
            "battery":self.supply.read(self.buzzer.quiet()).json(),
            "net":{"up":self.net_drawn.0,"down":self.net_drawn.1},
            "uptimeMinutes":self.started.elapsed().as_secs() / 60,
            "clock":ui::device_info::clock(self.state.as_ref(), now())
        }))
    }

    fn draw_main(&mut self) -> Result<()> {
        if self.input_waiting() {
            self.dirty = true;
            return Ok(());
        }
        let info = self.device_info();
        if let Some(app) = &mut self.app {
            app.update_device(info);
        }
        if let Some(app) = &self.app {
            self.screen.show_app(app)?;
        } else {
            self.screen.show_main(|d| match &self.state {
                Some(state) => ui::state_screen(d, state, self.offline),
                None => ui::flow_screen(d, &Screen::NotReady),
            })?;
        }
        self.mirror.send(self.screen.frame());
        Ok(())
    }
    fn redraw_current(&mut self) -> Result<()> {
        if !self.flow.is_idle() {
            if let Some(screen) = self.last_flow_screen.clone() {
                // The status bar as it is now: clock, battery, network arrows.
                self.device_info();
                return self.show(|d| ui::flow_screen(d, &screen));
            }
        }
        self.draw_main()
    }

    fn show(&mut self, draw: impl FnOnce(&mut Canvas) -> Result<(), Infallible>) -> Result<()> {
        self.screen.show(draw)?;
        self.mirror.send(self.screen.frame());
        Ok(())
    }

    /// Goes offline or back online, and redraws the main screen if it is up.
    fn set_offline(&mut self, offline: bool) {
        if self.offline == offline {
            return;
        }
        self.offline = offline;
        log::warn!(
            "site {}",
            if offline {
                "unreachable: showing it"
            } else {
                "reachable again"
            }
        );
        if self.flow.is_idle() {
            if let Err(e) = self.draw_main() {
                log::error!("display: {e:#}");
            }
        }
    }

    /// Syncs and says whether it worked. A device the site no longer knows links again.
    fn sync(&mut self, redraw: bool) -> bool {
        // A sync holds this loop, so the arrows are drawn before it starts (the panel refreshes
        // meanwhile); they go out a few seconds after (`net`).
        let shown = net::transfer(true);
        let _ = self.redraw_current();
        let synced = self.try_sync(redraw);
        drop(shown);
        match synced {
            Ok(()) => {
                if !self.confirmed {
                    if let Err(e) = ota::confirm(&self.store) {
                        log::error!("ota: could not confirm this firmware: {e:#}");
                    }
                    self.confirmed = true;
                }
                true
            }
            Err(e) if e.is::<api::Unauthorized>() => {
                log::warn!("the site unlinked this device, linking again");
                let _ = self.store.clear_token();
                reset::restart();
            }
            Err(e) => {
                log::error!("sync failed: {e:#}");
                self.set_offline(true);
                false
            }
        }
    }

    /// Sends queued takes and badges, then fetches state and draws its screen data.
    fn try_sync(&mut self, redraw: bool) -> Result<()> {
        wifi::reconnect(&mut self.wifi)?;
        if !self.queue.takes().is_empty() {
            let reply = self.api.takes(self.queue.takes())?;
            for rejected in &reply.rejected {
                log::warn!("take {} rejected: {}", rejected.id, rejected.reason);
            }
            self.queue.settle(&reply.done);
            self.save_queue();
            log::info!(
                "{} takes sent, {} left",
                reply.done.len(),
                self.queue.takes().len()
            );
        }

        let state = self.api.state()?;
        set_clock(&state.server_time);
        // Clear the banner with the new state, avoiding a refresh of stale content.
        self.offline = false;
        log::info!(
            "{} ({}), {} badges",
            state.device.name,
            state.office.name,
            state.badges.len()
        );
        self.store.set_state(&state)?;
        self.state = Some(state);

        self.api.status(&StatusReport {
            firmware_version: FIRMWARE_VERSION,
            // The site refuses what no battery reads: without the divider, the pin floats.
            battery_mv: self.supply.read(self.buzzer.quiet()).plausible_millivolts(),
            wifi_rssi: wifi::rssi(),
            unknown_badges: self.queue.unknown_badges(),
        })?;
        if !self.queue.unknown_badges().is_empty() {
            self.queue.clear_unknown_badges();
            self.save_queue();
        }

        if self.app_mode == Some(matecrew_core::contract::BuiltinApp::Showcase) {
            if let Some(app) = &mut self.app {
                app.update(
                    "showcase",
                    serde_json::to_value(self.state.as_ref().unwrap())?,
                );
                refresh_app_images(app, &self.api);
            }
            self.save_app_cache()?;
        } else if let Some(url) = self
            .state
            .as_ref()
            .and_then(|s| s.app_url.clone())
            .filter(|_| self.app_mode.is_none())
        {
            let bytes = self.api.app_bytecode(&url)?;
            let scene = ui::engine::Scene::from_bytecode(&bytes).map_err(anyhow::Error::msg)?;
            // Preserve local hook state when an unchanged app is synced again.
            let same = self.app.as_ref().is_some_and(|app| app.scene() == &scene);
            if self.app.is_none() || !same {
                self.app = Some(ui::engine::Runtime::new(scene).map_err(anyhow::Error::msg)?);
            }
            self.store.set_app(&url, &bytes)?;
            if let Some(app) = &mut self.app {
                let api = &self.api;
                let state = self.state.as_ref().unwrap();
                app.fetch_with(self.started.elapsed().as_millis() as u64, redraw, |path| {
                    if path == "/api/device/state" {
                        Ok(serde_json::to_value(state)?)
                    } else {
                        api.app_data(path)
                    }
                })?;
                refresh_app_images(app, api);
                self.store.set_app_data(app.data())?;
            }
        } else {
            self.app = None;
        }
        if redraw || self.flow.is_idle() {
            self.draw_main()?;
        }
        Ok(())
    }

    /// Installs the site's newer firmware, if any, and restarts on it. Only
    /// from a firmware that has synced: one that cannot is rolled back anyway.
    fn maybe_update(&mut self) {
        let firmware = self
            .state
            .as_ref()
            .and_then(|state| state.firmware.as_ref());
        let Some(release) = ota::wanted(firmware, &self.store).cloned() else {
            return;
        };
        if !self.confirmed || !self.flow.is_idle() {
            return;
        }
        log::info!(
            "ota: installing {} over {FIRMWARE_VERSION}",
            release.version
        );
        let (screen, mirror) = (&mut self.screen, &self.mirror);
        let mut draw = |percent: u8| {
            if screen
                .show(|d| ui::update_screen(d, &release.version, percent))
                .is_ok()
            {
                mirror.send(screen.frame());
            }
        };
        draw(0);
        match ota::install(&self.api, &release, &mut draw) {
            Ok(()) => {
                draw(100);
                if let Err(e) = self.store.set_ota_pending(Some(&release.version)) {
                    log::error!("ota: {e:#}");
                }
                self.screen.flush();
                reset::restart();
            }
            Err(e) => {
                log::error!("ota: {} failed: {e:#}", release.version);
                let _ = self.store.set_ota_failed(&release.version);
                let _ = self.show_main();
            }
        }
    }

    fn save_queue(&self) {
        if let Err(e) = self.store.set_queue(&self.queue) {
            log::error!("queue not saved: {e:#}");
        }
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// The site's clock is the reference: takes are stamped with it.
fn set_clock(server_time: &str) {
    if let Some(seconds) = time::parse_iso(server_time) {
        let tv = timeval {
            tv_sec: seconds as _,
            tv_usec: 0,
        };
        // SAFETY: plain call with a valid timeval and no timezone.
        unsafe { settimeofday(&tv, std::ptr::null()) };
    }
}

/// Image failures preserve the cached UI and never abort a stock sync or action.
fn refresh_app_images(app: &mut ui::engine::Runtime, api: &Api) {
    for request in app.image_requests() {
        match api.app_image(&request.src) {
            Ok(bytes) => {
                if let Err(error) = app.update_image(&request, &bytes) {
                    log::warn!("image decode: {error}");
                }
            }
            Err(error) => log::warn!("image download: {error:#}"),
        }
    }
}

/// Runtime diagnostics to verify that UI allocations leave room for Wi-Fi/USB.
fn log_heap() {
    use esp_idf_svc::sys::{
        heap_caps_get_free_size, heap_caps_get_largest_free_block, MALLOC_CAP_8BIT,
        MALLOC_CAP_INTERNAL, MALLOC_CAP_SPIRAM,
    };
    // SAFETY: ESP-IDF heap queries take capability flags and borrow no memory.
    unsafe {
        let flags = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
        log::info!(
            "heap: internal={} largest={} psram={} stack_min={}",
            heap_caps_get_free_size(flags),
            heap_caps_get_largest_free_block(flags),
            heap_caps_get_free_size(MALLOC_CAP_SPIRAM),
            esp_idf_svc::sys::uxTaskGetStackHighWaterMark(std::ptr::null_mut())
        );
    }
}
