//! matécrew badge terminal: Wi-Fi setup by QR, linking with a code shown on
//! the panel, then periodic syncs that draw the screen the site renders.

mod api;
mod display;
mod portal;
mod store;
mod wifi;

use anyhow::Result;
use esp_idf_svc::{
    eventloop::EspSystemEventLoop,
    hal::{peripherals::Peripherals, reset},
    nvs::EspDefaultNvsPartition,
    wifi::{BlockingWifi, EspWifi},
};
use matecrew_ui as ui;
use std::{
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use api::{Api, LinkPoll, ScreenUpdate, StatusReport};
use display::{Pins, Screen};
use store::Store;
use wifi::Wifi;

const FIRMWARE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Failed connections in a row before the device forgets the network and opens setup again.
const MAX_WIFI_FAILURES: u8 = 3;
/// Until the touch keys and deep sleep are wired, the device stays awake and syncs on a timer.
const SYNC_EVERY: Duration = Duration::from_secs(120);

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

    loop {
        match sync(&api, &mut screen, &store) {
            Ok(()) => {}
            Err(e) if e.is::<api::Unauthorized>() => {
                log::warn!("the site unlinked this device, linking again");
                store.clear_token()?;
                reset::restart();
            }
            Err(e) => log::error!("sync failed: {e:#}"),
        }
        thread::sleep(SYNC_EVERY);
    }
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

fn sync(api: &Api, screen: &mut Screen, store: &Store) -> Result<()> {
    let state = api.state()?;
    log::info!("{} ({}), {} badges", state.device.name, state.office.name, state.badges.len());
    api.status(&StatusReport {
        firmware_version: FIRMWARE_VERSION,
        wifi_rssi: wifi::rssi(),
        unknown_badges: Vec::new(),
    })?;

    let etag = store.screen_etag()?;
    match api.screen(etag.as_deref())? {
        ScreenUpdate::Unchanged => log::info!("screen unchanged"),
        ScreenUpdate::Changed { bits, etag } => {
            screen.show_bits(&bits)?;
            if let Some(etag) = etag {
                store.set_screen_etag(&etag)?;
            }
        }
    }
    Ok(())
}
