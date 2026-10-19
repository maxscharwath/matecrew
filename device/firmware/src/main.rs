//! matécrew badge terminal: Wi-Fi setup by QR, linking with a code shown on
//! the panel, takes with a key and a badge, and syncs that send the takes and
//! draw every screen locally from the site’s data.

mod api;
mod ble;
mod memory;
mod buzzer;
mod cache;
mod cores;
mod deflate;
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
mod sleep;
mod socket;
mod store;
mod viewers;
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
/// How long setup waits for a new network when some are kept already, before trying those again:
/// a linked terminal goes on from its cached state sooner (badges still count offline).
const SETUP_WAIT: Duration = Duration::from_secs(10 * 60);
const SETUP_WAIT_LINKED: Duration = Duration::from_secs(3 * 60);
/// Awake without the relay (a console watches over the long poll, a computer on USB), the
/// terminal syncs on a timer.
const SYNC_EVERY: Duration = Duration::from_secs(120);
/// With the relay's socket open, the site says when what the terminal shows changed: the timer
/// is only a safety net.
const SYNC_EVERY_LIVE: Duration = Duration::from_secs(15 * 60);
/// A socket reopened after this long without a sync syncs at once: changes may have been missed.
const RESYNC_AFTER: Duration = Duration::from_secs(60);
/// How soon to try again while the site does not answer.
const OFFLINE_RETRY: Duration = Duration::from_secs(30);
/// How often the NFC reader is asked for a badge while the flow waits for one.
const BADGE_POLL: Duration = Duration::from_millis(150);
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
    /// The serial console's `wifi setup`: setup at the next start, the networks kept stay.
    WifiSetup,
    /// The serial console's `wifi forget <ssid>`.
    ForgetNetwork(String),
    /// The serial console's `wifi`: the networks kept, in the log.
    Networks,
    /// An app's data or image, from the fetching thread.
    Fetched(fetch::Fetched),
    /// A touch key, already beeped by the keys thread the moment it was touched.
    Pressed(Event),
    /// A transfer with the site started or ended: the status bar's arrows may change.
    Net,
    /// A browser connected, paired or left over Bluetooth, or a pairing waits for the passkey.
    Bluetooth,
    /// The relay says what the terminal shows changed on the site at this time (ms since 1970).
    Changed(f64),
    /// The relay's socket opened or closed.
    Live(bool),
    /// Deep sleep now, whatever keeps it awake (the serial console's `sleep`, a console's); the
    /// timer capped at this.
    Doze(Option<Duration>),
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
/// Unused this long, the terminal goes to deep sleep (`doze`).
const DOZE_AFTER: Duration = Duration::from_secs(120);
/// Woken by its timer, it sleeps again this long after it started at the latest...
const DOZE_AGAIN: Duration = Duration::from_secs(10);
/// ... or this long after the relay's socket opened: the relay hands over the commands that
/// waited and says whether a console watches right after the hello.
const LINGER: Duration = Duration::from_millis(1500);
/// Kept awake (a console, the USB cable, a message on screen), it asks again this often.
const DOZE_RECHECK: Duration = Duration::from_secs(30);
/// Asleep inside office hours, it wakes up this often to sync: what the site changed shows.
const DAY_WAKE: Duration = Duration::from_secs(15 * 60);
/// Asleep outside them, this often to set its clock: the RTC drifts by a minute or so an hour.
const NIGHT_WAKE: Duration = Duration::from_secs(2 * 60 * 60);
/// Not worth a deep sleep: it would wake up again at once.
const MIN_DOZE: Duration = Duration::from_secs(60);
/// The clock is redrawn this long before the minute turns: drawing it and the panel's partial
/// refresh take about that, so the new minute shows as it starts.
const CLOCK_LEAD: Duration = Duration::from_millis(1100);
/// NTP set the clock this recently: it is right to the second, the site's time is not.
const NTP_TRUSTED: i64 = 3 * 60 * 60;
/// When NTP last set the clock, seconds since 1970; 0 before.
/// (32 bits: the ESP32-S3 has no 64-bit atomics; seconds fit until 2106.)
static NTP_AT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

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
    // First, before anything else: a cold start clears what the RTC kept.
    let wake = sleep::woke();
    let kept = sleep::shown();
    // From deep sleep the panel shows the stock or the night screen: nothing on the way shows,
    // flashes or plays the boot melody.
    let warm = kept.is_some();
    log::info!("start: {wake:?}");

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
    let sounds = match store.state() {
        Ok(Some(state)) => {
            ui::set_locale(&state.office.locale);
            state.sounds
        }
        _ => None,
    };
    boot.start("screen", &[]);
    boot.done("screenReady", &[]);
    if !warm {
        screen.show(|d| boot.render(d))?;
    }
    if let Err(e) = console::watch(sender.clone()) {
        log::warn!("no serial console commands: {e:#}");
    }
    // SAFETY: the buzzer drives D5 only while it beeps, between battery readings (`Supply`
    // waits for it to be quiet).
    let buzzer = cores::on(Core::Core1, || {
        Buzzer::start(p.ledc.timer0, p.ledc.channel0, unsafe { Gpio6::steal() })
    })?;
    // D5 (GPIO 6): half the battery voltage, and the piezo. Without the ADC the status bar says "--".
    // Set up before the boot melody: configuring the channel turns the pin's output off, which
    // cut the melody after its first milliseconds.
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
    buzzer.set_sounds(sounds.unwrap_or(matecrew_core::contract::Sounds::ALL));
    // Its melody when it starts, or when a key wakes it; a timer's wake stays silent.
    if !warm || matches!(wake, sleep::Wake::Key(_)) {
        buzzer.beep(matecrew_core::flow::Beep::Boot);
    }
    // The key that woke it: a press over the stock, only a wake over the night screen.
    let woken = match (wake, kept.as_ref().map(|kept| kept.night.is_none())) {
        (sleep::Wake::Key(side), Some(true)) => keys::Woken::Press(side),
        (sleep::Wake::Key(side), _) => keys::Woken::Ignore(side),
        _ => keys::Woken::No,
    };
    cores::on(Core::Core1, || {
        keys::watch(p.pins.gpio5, p.pins.gpio8, sender.clone(), buzzer.clone(), woken)
    })?;
    // The reader stays asleep until a badge is wanted, unless it is kept awake.
    let nfc = match Nfc::new(p.i2c0, p.pins.gpio43, p.pins.gpio44) {
        Ok(mut nfc) => {
            if nfc::ALWAYS_AWAKE {
                if let Err(e) = nfc.wake() {
                    log::warn!("NFC: {e:#}");
                }
            }
            Some(nfc)
        }
        Err(e) => {
            log::warn!("no NFC bus ({e:#}): badges come from the console, `b <uid>`");
            None
        }
    };

    let mut wifi = BlockingWifi::wrap(
        EspWifi::new(p.modem, sys_loop.clone(), Some(nvs.clone()))?,
        sys_loop,
    )?;
    // Bluetooth LE: setup, control and updates from a browser nearby.
    let before = free_internal_heap();
    let ble = start_ble(&wifi, Store::new(nvs)?, sender.clone());
    log::info!("memory: Bluetooth takes {} KB of internal RAM", before.saturating_sub(free_internal_heap()) / 1024);
    let bluetooth = ble.as_ref().map(ble::Ble::label).unwrap_or_default();
    let site = store
        .site()?
        .unwrap_or_else(|| api::DEFAULT_SITE.to_owned());
    log::info!("site {site}");
    let networks = store.networks()?;
    let linked = store.token()?.is_some();
    if networks.is_empty() || store.wifi_setup_asked()? {
        store.ask_wifi_setup(false)?;
        setup_wifi(&mut wifi, &mut screen, &store, &site, &bluetooth, &inputs, &networks, false, linked)?;
        reset::restart();
    }

    let last = networks.last().map(|network| network.ssid.clone()).unwrap_or_default();
    boot.start("wifiJoining", &[("ssid", &last)]);
    if !warm {
        screen.show(|d| boot.render(d))?;
    }
    if !linked {
        // Setting up: say what happens at each step.
        screen.show(|d| ui::connecting_screen(d, &last))?;
    }
    let joined = if warm && matches!(wake, sleep::Wake::Key(_)) {
        // A key woke it: the key first, the network meanwhile.
        wifi::start_joining(&mut wifi, &networks, sleep::access_point())
    } else {
        wifi::connect(&mut wifi, &networks, sleep::access_point())
    };
    let ssid = match joined {
        Ok(ssid) => {
            store.joined_wifi(&ssid)?;
            match wifi::rssi() {
                Some(rssi) => boot.done("wifiJoined", &[("ssid", &ssid), ("rssi", &rssi.to_string())]),
                None => boot.done("wifiJoinedQuiet", &[("ssid", &ssid)]),
            }
            ssid
        }
        Err(e) if linked && warm => {
            // A paired terminal must still boot and accept badges using cached state.
            log::warn!("Wi-Fi unavailable, starting from cached state: {e:#}");
            boot.fail("wifiOffline", &[]);
            last
        }
        Err(e) => {
            // None of the networks kept answers (moved to another office, a new password):
            // setup, to add one. Those kept stay, and are tried again if nobody adds one.
            log::warn!("Wi-Fi: {e:#}; setup opens");
            boot.fail("wifiOffline", &[]);
            // A new network: start over on it. Not linked yet: nothing to do offline, try again.
            if setup_wifi(&mut wifi, &mut screen, &store, &site, &bluetooth, &inputs, &networks, true, linked)? || !linked {
                reset::restart();
            }
            // Later: from the cached state, offline; the syncs try the networks kept in turn.
            log::info!("setup left for later, starting from cached state");
            wifi.stop()?;
            wifi::start_joining(&mut wifi, &networks, None)?
        }
    };
    // The clock from the internet (NTP, every hour), whether the site answers or not: the status
    // bar and the takes' times are right after a restart. A sync with the site sets it too.
    let sntp = cores::on(Core::Core0, || {
        EspSntp::new_with_callback(&SntpConf::default(), |since_epoch| {
            net::pulse(false);
            NTP_AT.store(since_epoch.as_secs() as u32, std::sync::atomic::Ordering::Relaxed);
            log::info!("clock set by NTP: {} s since 1970", since_epoch.as_secs())
        })
    })
    .inspect_err(|e| log::warn!("no NTP clock: {e}"))
    .ok();
    if !linked {
        let ip = wifi.wifi().sta_netif().get_ip_info()?.ip.to_string();
        screen.show(|d| ui::connected_screen(d, &ssid, &ip))?;
    }

    let token = match store.token()? {
        Some(token) => token,
        None => link(&wifi, &mut screen, &store, &site, &bluetooth)?,
    };

    let claim_key = claim::key(&token);
    boot.start("site", &[]);
    boot.done("siteReady", &[("host", api::host(&site))]);
    boot.start("apps", &[]);
    if !warm {
        screen.show(|d| boot.render(d))?;
    }
    let live = remote::Live::new(
        token.clone(),
        matecrew_core::live::Status { firmware: Some(FIRMWARE_VERSION.to_owned()), ..Default::default() },
    );
    let api = Api::with_token(&site, token);
    let state = store.state()?;
    // The relay from the last state: the socket opens before the first sync.
    live.set_url(state.as_ref().and_then(|s| s.realtime.as_ref()).map(|r| r.url.clone()));
    cores::on(Core::Core0, || remote::start(api.clone(), live.clone(), sender.clone()))?;
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
    if !warm {
        screen.show(|d| boot.render(d))?;
    }
    Terminal {
        site: site.clone(),
        claim_key,
        fetcher: cores::on(Core::Core0, || fetch::Fetcher::start(api.clone(), sender.clone()))?,
        _sntp: sntp,
        _ble: ble,
        bluetooth,
        pressed: false,
        net_drawn: (false, false),
        ble_drawn: (false, false),
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
        ssid,
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
        live,
        synced: None,
        wake,
        kept,
        // Woken by its timer, it is still asleep for the office: the moon stays.
        dozing: wake == sleep::Wake::Timer,
        touched: Instant::now(),
        doze_at: Instant::now() + if wake == sleep::Wake::Timer { DOZE_AGAIN } else { DOZE_AFTER },
        device_drawn: serde_json::Value::Null,
        kept_awake: None,
        clock_drawn: 0,
        clock_for: None,
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

/// Opens the setup access point, shows its QR and waits for the phone to send a Wi-Fi, added to
/// the networks kept. A browser can send it over Bluetooth meanwhile (`ble.rs` saves it and
/// restarts). `missing`: none of the networks kept answered, which the screen names.
///
/// With networks kept, setup does not wait forever: they are tried again after `SETUP_WAIT`. A
/// linked terminal also goes on at a key ("Plus tard"), from its cached state. False when it
/// ends so, without a new network.
#[allow(clippy::too_many_arguments)]
fn setup_wifi(
    wifi: &mut Wifi,
    screen: &mut Panel,
    store: &Store,
    site: &str,
    bluetooth: &str,
    inputs: &Receiver<Input>,
    kept: &matecrew_core::networks::Networks,
    missing: bool,
    linked: bool,
) -> Result<bool> {
    let ap = wifi::start_setup_access_point(wifi)?;
    log::info!("setup access point {} at {}", ap.ssid, ap.ip);
    ble::set_networks(ap.networks.clone());
    let portal_url = format!("http://{}", ap.ip);
    let later = linked && !kept.is_empty();
    let missing = if missing { kept.names() } else { String::new() };
    screen.show(|d| {
        ui::setup_screen(
            d,
            &ui::SetupInfo {
                ap_ssid: &ap.ssid,
                ap_password: &ap.password,
                portal_url: &portal_url,
                bluetooth,
                missing: &missing,
                later,
            },
        )
    })?;

    let (saved, received) = mpsc::channel();
    let _portal = portal::serve(ap.ip.parse()?, ap.networks, site.to_owned(), saved)?;
    let until = (!kept.is_empty()).then(|| Instant::now() + if linked { SETUP_WAIT_LINKED } else { SETUP_WAIT });
    let setup = loop {
        match received.recv_timeout(Duration::from_millis(200)) {
            Ok(setup) => break setup,
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => bail!("the setup page stopped"),
        }
        // Keys and console lines while setup shows: a key is "later" when it can be.
        while let Ok(input) = inputs.try_recv() {
            if later && matches!(input, Input::Pressed(_) | Input::Flow(Event::Key { .. })) {
                return Ok(false);
            }
        }
        if until.is_some_and(|until| Instant::now() >= until) {
            log::info!("nobody added a network: trying {} again", kept.names());
            return Ok(false);
        }
    };
    let creds = setup.wifi;
    log::info!("Wi-Fi {:?} and site {} saved", creds.ssid, setup.site);
    let ssid = creds.ssid.clone();
    store.remember_wifi(creds)?;
    // A linked terminal keeps its site: the page only adds a network.
    if !linked {
        store.set_site(&setup.site)?;
    }
    // Drawing takes a few seconds: time enough for the confirmation page to
    // reach the phone before the access point goes away. The panel keeps the
    // message through the restart.
    screen.show(|d| ui::connecting_screen(d, &ssid))?;
    Ok(true)
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
                    // Maybe the wrong site or the wrong network: set up again, networks kept.
                    store.ask_wifi_setup(true)?;
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
    /// A key press being handled already beeped: the key beep its screen asks for is that one.
    pressed: bool,
    /// The network arrows (up, down) the last drawn screen shows.
    net_drawn: (bool, bool),
    /// The Bluetooth link the status bar shows: connected, paired.
    ble_drawn: (bool, bool),
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
    /// The relay's socket: commands, the mirror, "what you show changed".
    live: remote::Live,
    /// When the last sync worked.
    synced: Option<Instant>,
    /// Why it started: a cold start, or its timer or a key after a deep sleep.
    wake: sleep::Wake,
    /// What the panel kept through the deep sleep, drawn again first (`assume`).
    kept: Option<sleep::Shown>,
    /// Asleep for the office: the moon instead of the clock in the status bar, and no arrows. Set
    /// before a deep sleep and through a timer wake; any key or command clears it.
    dozing: bool,
    /// The last key, tap, badge or command.
    touched: Instant,
    /// When to go to deep sleep, if nothing keeps the terminal awake then.
    doze_at: Instant,
    /// `$device` as the last screen was drawn with it, kept through a deep sleep.
    device_drawn: serde_json::Value,
    /// Why it stayed awake at the last try, logged when that changes.
    kept_awake: Option<&'static str>,
    /// The minute the clock was last redrawn for, seconds since 1970.
    clock_drawn: i64,
    /// While the clock is redrawn ahead of the minute: the time it shows.
    clock_for: Option<i64>,
}

enum Next {
    OverlayDue,
    /// Idle long enough to go to deep sleep.
    DozeDue,
    /// The minute turns: the clock is redrawn for it (seconds since 1970).
    ClockDue(i64),
    Input(Input),
    /// The flow's deadline passed.
    Tick,
    /// Idle, and time to sync.
    SyncDue,
}

impl Terminal {
    fn run(mut self) -> Result<()> {
        if let Some(kept) = self.kept.take() {
            let night = kept.night.is_some();
            self.assume(kept);
            if night && self.wake != sleep::Wake::Timer {
                // A key over the night screen: the stock, awake.
                self.draw_main()?;
            }
        }
        let mut sync_at = match self.wake {
            sleep::Wake::Cold | sleep::Wake::Timer => {
                if self.wake == sleep::Wake::Cold {
                    // Keys touched during setup or linking do not count.
                    while self.inputs.try_recv().is_ok() {}
                }
                self.sync(false);
                self.maybe_update();
                self.next_sync()
            }
            // The key first (it is in the channel); the sync once the terminal is idle again.
            sleep::Wake::Key(_) => Instant::now(),
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
                        let late = net::lit_ago();
                        let started = Instant::now();
                        self.redraw_current()?;
                        log::info!(
                            "net: arrows {:?} drawn {} ms after the exchange, in {} ms",
                            net::shown(),
                            late.as_millis(),
                            started.elapsed().as_millis()
                        );
                    }
                }
                Next::Input(Input::Bluetooth) => {
                    // The passkey shows over any screen while the computer asks for it.
                    let pairing = ui::notifications::pairing(ble::pairing());
                    if pairing || ble::linked() != self.ble_drawn {
                        self.redraw_current()?;
                    }
                }
                Next::Input(Input::Tap(x, y)) => {
                    self.touch();
                    self.tap_screen(x, y)?
                }
                Next::Input(Input::Pressed(event)) => {
                    self.touch();
                    self.pressed = true;
                    let stepped = self.step(event);
                    self.pressed = false;
                    stepped?
                }
                Next::Input(Input::Flow(event)) => {
                    // The reader polls whenever the terminal is awake: a badge left on it does not
                    // keep the terminal from its deep sleep.
                    let heeded = match &event {
                        Event::Badge { uid } => self.flow.heeds_badge(uid, self.started.elapsed().as_millis() as u64),
                        _ => true,
                    };
                    if heeded {
                        self.touch();
                    }
                    // Keys from the console or the site beep here, the touch keys did already.
                    self.pressed = matches!(event, Event::Key { .. } | Event::LongKey { .. } | Event::BothKeys);
                    if self.pressed {
                        self.buzzer.beep(matecrew_core::flow::Beep::Key);
                    }
                    let stepped = self.step(event);
                    self.pressed = false;
                    stepped?
                }
                Next::Tick => self.step(Event::Tick)?,
                Next::ClockDue(minute) => {
                    self.clock_drawn = minute;
                    self.clock_for = Some(minute);
                    let drawn = self.redraw_current();
                    self.clock_for = None;
                    drawn?
                }
                Next::DozeDue => {
                    let awake_for = self.awake_for();
                    match awake_for {
                        None => self.doze(false, None)?,
                        Some(reason) if self.kept_awake != awake_for => log::info!("sleep: not now, {reason}"),
                        Some(_) => {}
                    }
                    if awake_for.is_some() && self.dozing {
                        // Woken by its timer but kept awake: the moon would say it sleeps.
                        self.wake_up();
                        self.redraw_current()?;
                    }
                    self.kept_awake = awake_for;
                    // Still here: something kept it awake.
                    self.doze_at = self.doze_at.max(Instant::now() + DOZE_RECHECK);
                }
                Next::Input(Input::Doze(cap)) => {
                    if self.flow.is_idle() {
                        self.doze(true, cap)?;
                    } else {
                        log::warn!("sleep: not while the screen waits for someone");
                    }
                }
                Next::SyncDue if self.touched.elapsed() < SYNC_WHEN_IDLE => {
                    sync_at = self.touched + SYNC_WHEN_IDLE;
                }
                Next::Input(Input::Sync) | Next::SyncDue => {
                    if self.flow.is_idle() {
                        self.sync(false);
                        if self.touched.elapsed() >= CLEAN_WHEN_IDLE {
                            self.screen.clean()?;
                        }
                        self.screen.rest()?;
                        self.maybe_update();
                        sync_at = self.next_sync();
                    }
                }
                Next::Input(Input::Changed(at)) => {
                    let built = self.state.as_ref().and_then(|s| time::parse_iso(&s.server_time));
                    if matecrew_core::live::is_news(at, built) {
                        log::info!("relay: what the terminal shows changed, syncing");
                        sync_at = sync_at.min(Instant::now());
                    }
                }
                Next::Input(Input::Live(true)) => {
                    if self.synced.is_none_or(|at| at.elapsed() >= RESYNC_AFTER) {
                        sync_at = sync_at.min(Instant::now());
                    }
                    if self.dozing {
                        self.doze_at = self.doze_at.min(Instant::now() + LINGER);
                    }
                }
                Next::Input(Input::Live(false)) => {
                    // Nothing says when to sync any more: the timer does again.
                    sync_at = sync_at.min(Instant::now() + SYNC_EVERY);
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
                Next::Input(Input::WifiSetup) => {
                    log::info!("Wi-Fi setup asked, restarting into it");
                    self.store.ask_wifi_setup(true)?;
                    reset::restart();
                }
                Next::Input(Input::ForgetNetwork(ssid)) => {
                    // The one in use stays joined until it goes.
                    match self.store.forget_wifi(&ssid)? {
                        true => log::info!("Wi-Fi {ssid:?} forgotten"),
                        false => log::warn!("Wi-Fi {ssid:?} is not kept"),
                    }
                }
                Next::Input(Input::Networks) => {
                    let networks = self.store.networks()?;
                    log::info!("Wi-Fi: {} kept, joined last first: {}", networks.len(), networks.names());
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
            let now = Instant::now();
            if self.flow.is_idle() && now >= self.doze_at {
                return Ok(Next::DozeDue);
            }
            let clock = self.next_minute(now);
            if let Some((_, minute)) = clock.filter(|&(at, _)| now >= at) {
                return Ok(Next::ClockDue(minute));
            }
            let mut deadline = self
                .flow
                .deadline()
                .map_or(sync_at.min(self.doze_at), |ms| self.started + Duration::from_millis(ms));
            if let Some((at, _)) = clock {
                deadline = deadline.min(at);
            }
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
            let wait = if self.flow.wants_badge() {
                BADGE_POLL.min(deadline - now)
            } else {
                if let Some(Err(e)) = self.nfc.as_mut().map(Nfc::rest) {
                    log::warn!("NFC: {e:#}");
                }
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
        // A long left press is the short one for an app; the right one is the badge holder's
        // purchases, like both keys (its about page), whatever app runs. Past the app (the
        // purchases), either one held is the flow's: it leaves them.
        let event = match event {
            Event::LongKey { side: matecrew_core::contract::Side::Left } if self.app.is_some() && self.flow.is_idle() => {
                Event::Key { side: matecrew_core::contract::Side::Left }
            }
            event => event,
        };
        if self.flow.is_idle() && event != Event::BothKeys {
            if let Event::Key { side } = &event {
                if let Some(app) = &mut self.app {
                    app.tick(self.started.elapsed().as_millis() as u64);
                    let name = if *side == matecrew_core::contract::Side::Left { "left" } else { "right" };
                    // A key the screen binds nothing to does nothing.
                    let effects = app.input(name).unwrap_or_default();
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
        // The account's answers go to the flow, which waits for them (failures logged by fetch).
        let fetched = match fetched {
            fetch::Fetched::Account(reply) => {
                return self.step_domain(match reply {
                    Ok(account) => Event::Account { account },
                    Err(failure) => Event::AccountFailed { failure },
                });
            }
            fetch::Fetched::Cancelled(reply) => {
                return self.step_domain(match reply {
                    Ok(reply) => {
                        log::info!("purchase cancelled: {} ({:?})", reply.cancelled, reply.reason);
                        Event::PurchaseCancelled { cancelled: reply.cancelled }
                    }
                    Err(failure) => Event::AccountFailed { failure },
                });
            }
            fetched => fetched,
        };
        let Some(app) = &mut self.app else { return Ok(()) };
        match fetched {
            fetch::Fetched::Account(_) | fetch::Fetched::Cancelled(_) => return Ok(()),
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
                // On the network thread: the keys never wait for the site.
                Effect::FetchAccount { uid } => self.fetcher.request(fetch::Job::Account { uid }),
                Effect::CancelPurchase { uid, id } => {
                    self.fetcher.request(fetch::Job::CancelPurchase { uid, id })
                }
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
                    avatar: reply.avatar,
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
        self.ble_drawn = ble::linked();
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
        // Asleep for the office, the status bar keeps still: a sync's arrows would refresh it.
        let net = if self.dozing { (false, false) } else { self.net_drawn };
        self.device_drawn = serde_json::json!({
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
            "net":{"up":net.0,"down":net.1},
            "sleeping":self.dozing,
            "ble":{"connected":self.ble_drawn.0,"paired":self.ble_drawn.1},
            "memory":memory::json(),
            "uptimeMinutes":self.started.elapsed().as_secs() / 60,
            "clock":ui::device_info::clock(self.state.as_ref(), self.clock_for.unwrap_or_else(now)),
            "date":ui::device_info::date(self.state.as_ref(), self.clock_for.unwrap_or_else(now))
        });
        ui::device_info::set(self.device_drawn.clone())
    }

    fn draw_main(&mut self) -> Result<()> {
        if self.input_waiting() {
            self.dirty = true;
            return Ok(());
        }
        self.draw_main_now()
    }

    /// The idle screen, even with more inputs waiting.
    fn draw_main_now(&mut self) -> Result<()> {
        let gathered = Instant::now();
        let info = self.device_info();
        log::info!("draw: device info in {} ms", gathered.elapsed().as_millis());
        if let Some(night) = self.night() {
            self.screen.show(|d| ui::sleep_screen(d, night.weekend, night.weekday, &night.time))?;
            return Ok(());
        }
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

    /// When to sync next: soon while offline; else on the timer (a safety net while the relay says
    /// when), or when the state changes by itself (`refresh_at`), whichever comes first.
    fn next_sync(&self) -> Instant {
        let now = Instant::now();
        if self.offline {
            return now + OFFLINE_RETRY;
        }
        let every = if self.live.connected() { SYNC_EVERY_LIVE } else { SYNC_EVERY };
        let refresh = self
            .state
            .as_ref()
            .and_then(|s| s.refresh_at.as_deref())
            .and_then(time::parse_iso)
            .map(|at| at - self::now())
            .filter(|&ahead| ahead > 0)
            .map(|ahead| Duration::from_secs(ahead as u64));
        now + refresh.map_or(every, |refresh| refresh.min(every))
    }

    /// The app on the panel, for the console.
    fn app_name(&self) -> &'static str {
        match (self.app_mode, self.app.is_some()) {
            (Some(matecrew_core::contract::BuiltinApp::Showcase), _) => "showcase",
            (_, true) => "downloaded",
            _ => "mate",
        }
    }

    /// Syncs and says whether it worked. A device the site no longer knows links again.
    fn sync(&mut self, redraw: bool) -> bool {
        // A sync holds this loop, so the arrows are drawn before it starts (the panel refreshes
        // meanwhile); they go out a few seconds after (`net`).
        let shown = net::transfer(true);
        if !self.dozing {
            let _ = self.redraw_current();
        }
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
        let ssid = wifi::reconnect(&mut self.wifi, &self.store.networks()?)?;
        sleep::keep_access_point(wifi::access_point());
        if ssid != self.ssid {
            // Another network kept answered: tried first from now on.
            self.store.joined_wifi(&ssid)?;
            self.ssid = ssid;
        }
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
        self.live.set_url(state.realtime.as_ref().map(|r| r.url.clone()));
        self.buzzer.set_sounds(state.sounds.unwrap_or(matecrew_core::contract::Sounds::ALL));
        self.state = Some(state);

        // The site refuses what no battery reads: without the divider, the pin floats.
        let battery_mv = self.supply.read(self.buzzer.quiet()).plausible_millivolts();
        let wifi_rssi = wifi::rssi();
        self.api.status(&StatusReport {
            firmware_version: FIRMWARE_VERSION,
            battery_mv,
            wifi_rssi,
            unknown_badges: self.queue.unknown_badges(),
        })?;
        self.synced = Some(Instant::now());
        self.live.report(matecrew_core::live::Status {
            firmware: Some(FIRMWARE_VERSION.to_owned()),
            battery_mv,
            rssi: wifi_rssi,
            app: Some(self.app_name().to_owned()),
            heap: Some(free_internal_heap()),
            uptime: Some(self.started.elapsed().as_secs()),
            synced_at: Some(now() * 1000),
        });
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
        let screen = &mut self.screen;
        let mut draw = |percent: u8| {
            let _ = screen.show(|d| ui::update_screen(d, &release.version, percent));
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

    /// When to redraw the clock for the next minute (`CLOCK_LEAD` ahead), and that minute; `None`
    /// while it shows none (asleep for the office) or does not know the time yet.
    fn next_minute(&self, now: Instant) -> Option<(Instant, i64)> {
        if self.dozing || self.state.is_none() {
            return None;
        }
        let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_millis() as i64;
        if now_ms / 1000 <= CLOCK_SET_AFTER {
            return None;
        }
        let mut minute = (now_ms / 60_000 + 1) * 60;
        if minute <= self.clock_drawn {
            minute += 60;
        }
        let ahead = (minute * 1000 - CLOCK_LEAD.as_millis() as i64 - now_ms).max(0);
        Some((now + Duration::from_millis(ahead as u64), minute))
    }

    /// A key, a tap, a badge or a command: awake, the clock back in the status bar, and deep
    /// sleep DOZE_AFTER from now.
    fn touch(&mut self) {
        self.wake_up();
        self.touched = Instant::now();
        self.doze_at = self.touched + DOZE_AFTER;
    }

    /// Awake for good: the clock instead of the moon on the next screen, whichever it is (only
    /// the main screen reads `$device` again).
    fn wake_up(&mut self) {
        if std::mem::take(&mut self.dozing) {
            self.device_info();
        }
    }

    /// Whether someone did something the loop has not handled yet: a key, a badge, a command.
    /// What the terminal does by itself does not count: the network's arrows (a console's
    /// command lights them, a sleep among them), Bluetooth's state, the relay's socket, a fetch.
    fn someone_waiting(&mut self) -> bool {
        self.pending.extend(self.inputs.try_iter());
        self.pending.iter().any(|input| {
            !matches!(input, Input::Net | Input::Bluetooth | Input::Live(_) | Input::Changed(_) | Input::Fetched(_) | Input::Doze(_))
        })
    }

    /// Why the terminal stays awake now; `None` when it may go to deep sleep.
    fn awake_for(&self) -> Option<&'static str> {
        if self.state.as_ref().and_then(|state| state.hours.as_ref()).is_none() {
            return Some("the site gives no office hours");
        }
        // SAFETY: reads whether a USB host sent start-of-frame packets lately.
        if unsafe { esp_idf_svc::sys::usb_serial_jtag_is_connected() } {
            return Some("a computer on USB (the serial console's `sleep` sleeps anyway)");
        }
        if remote::watching() {
            return Some("a console watches");
        }
        if ble::linked().0 {
            return Some("a browser is connected over Bluetooth");
        }
        if !self.flow.is_idle() || self.pending_app.is_some() || !self.pending.is_empty() {
            return Some("in use");
        }
        let overlay = ui::notifications::deadline().or_else(|| self.app.as_ref().and_then(|app| app.overlay_deadline()));
        overlay.map(|_| "a message on screen")
    }

    /// While asleep through closed hours: the night screen's words. `None` awake, inside the
    /// hours, or when the hours the site gave are out of date.
    fn night(&self) -> Option<sleep::Night> {
        let hours = self.state.as_ref()?.hours.as_ref()?;
        let ahead = time::parse_iso(&hours.until).is_some_and(|until| until > now());
        (self.dozing && !hours.open && ahead).then(|| sleep::Night {
            weekend: hours.weekend,
            weekday: hours.weekday,
            time: hours.time.clone(),
        })
    }

    /// After a deep sleep: draws again the screen the panel kept, without refreshing it, so the
    /// next screen is a partial refresh from it rather than a flash.
    fn assume(&mut self, kept: sleep::Shown) {
        let drawn: serde_json::Value = serde_json::from_str(&kept.device).unwrap_or_default();
        self.offline = drawn["offline"].as_bool().unwrap_or(false);
        // The night screen comes before any main screen, which sets the theme otherwise.
        if let Some(state) = &self.state {
            ui::set_theme(ui::Theme::from_name(&state.theme));
        }
        self.device_drawn = drawn["device"].clone();
        let info = ui::device_info::set(self.device_drawn.clone());
        if let Some(app) = &mut self.app {
            app.update_device(info);
        }
        let offline = self.offline;
        let (screen, app, state) = (&mut self.screen, self.app.as_ref(), self.state.as_ref());
        let same = match (&kept.night, app, state) {
            (Some(night), _, _) => screen.assume(|d| ui::sleep_screen(d, night.weekend, night.weekday, &night.time), kept.digest, kept.wear),
            (None, Some(app), _) => {
                screen.assume(|d| ui::render_app(d, app, ui::app_scale(app.scene())), kept.digest, kept.wear)
            }
            (None, None, Some(state)) => screen.assume(|d| ui::state_screen(d, state, offline), kept.digest, kept.wear),
            (None, None, None) => false,
        };
        if same {
            log::info!("wake: the panel's screen drawn again, {:?}", kept.wear);
        } else {
            log::warn!("wake: the screen drawn again is not the panel's: the next one takes a full refresh");
        }
    }

    /// Deep sleep, with the stock and the moon inside office hours (waking up every DAY_WAKE to
    /// sync, when the site's state changes by itself, and at closing), with the night screen
    /// outside them (waking up when they open). A key wakes it. `forced`: asked for (a console,
    /// the serial one), even without office hours or for a short while; `cap`: its timer at the
    /// latest. Returns only when it did not sleep: a key meanwhile, or too soon to be worth it.
    fn doze(&mut self, forced: bool, cap: Option<Duration>) -> Result<()> {
        let stale = |terminal: &Self| {
            let until = terminal.state.as_ref().and_then(|s| s.hours.as_ref()).and_then(|h| time::parse_iso(&h.until));
            until.is_some_and(|until| until <= now())
        };
        if stale(self) {
            // The office opened or closed since the last sync: what now?
            self.sync(false);
        }
        let hours = self.state.as_ref().and_then(|s| s.hours.clone());
        if hours.is_none() && !forced {
            return Ok(());
        }
        // Without hours from the site, only when asked for: as inside them.
        let open = hours.as_ref().is_none_or(|hours| hours.open) || stale(self);
        let mut wake_in = if open { DAY_WAKE } else { NIGHT_WAKE };
        let ahead = |at: Option<i64>| at.map(|at| at - now()).filter(|&s| s > 0).map(|s| Duration::from_secs(s as u64));
        if let Some(until) = ahead(hours.as_ref().and_then(|hours| time::parse_iso(&hours.until))) {
            wake_in = wake_in.min(until);
        }
        if open {
            let refresh = self.state.as_ref().and_then(|s| s.refresh_at.as_deref()).and_then(time::parse_iso);
            if let Some(refresh) = ahead(refresh) {
                wake_in = wake_in.min(refresh);
            }
        }
        if let Some(cap) = cap {
            wake_in = wake_in.min(cap);
        }
        if !forced && wake_in < MIN_DOZE {
            log::info!("sleep: not for {} s", wake_in.as_secs());
            return Ok(());
        }

        if self.someone_waiting() {
            return Ok(());
        }
        self.dozing = true;
        self.draw_main_now()?;
        self.save_app_cache()?;
        self.screen.clean()?;
        self.screen.rest()?;
        // Once the panel shows it, its controller asleep: a refresh takes 1 to 2 s.
        let wear = self.screen.wear();
        if self.someone_waiting() {
            // Touched meanwhile: the loop handles it, the clock back.
            self.wake_up();
            self.dirty = true;
            return Ok(());
        }
        let shown = sleep::Shown {
            device: serde_json::json!({ "device": self.device_drawn, "offline": self.offline }).to_string(),
            night: self.night(),
            digest: sleep::digest(self.screen.sent()),
            wear,
        };
        self.live.sleep(Some((now() + wake_in.as_secs() as i64) * 1000));
        if let Some(nfc) = &mut self.nfc {
            if let Err(e) = nfc.power_down() {
                log::warn!("NFC: {e:#}");
            }
        }
        // The relay's close frame on its way before the radio stops.
        thread::sleep(Duration::from_millis(100));
        let _ = self.wifi.disconnect();
        let _ = self.wifi.stop();
        sleep::sleep(shown, Some(wake_in))
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// The site's clock is the reference for takes, unless NTP set the clock lately: NTP is right to
/// the millisecond, `server_time` only to the second, a request's time later. Two seconds apart,
/// the site's wins anyway.
fn set_clock(server_time: &str) {
    use std::sync::atomic::Ordering;
    let ntp = now() - i64::from(NTP_AT.load(Ordering::Relaxed)) < NTP_TRUSTED;
    if let Some(seconds) = time::parse_iso(server_time).filter(|&seconds| !ntp || (seconds - now()).abs() > 2) {
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

/// Internal RAM free, bytes: task stacks, DMA, Wi-Fi timers.
fn free_internal_heap() -> u32 {
    use esp_idf_svc::sys::{heap_caps_get_free_size, MALLOC_CAP_8BIT, MALLOC_CAP_INTERNAL};
    // SAFETY: a heap query with capability flags; borrows no memory.
    unsafe { heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) as u32 }
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
