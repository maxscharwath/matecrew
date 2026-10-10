//! Bluetooth LE link: a browser nearby (Web Bluetooth, `device/sdk/link`) sets up the Wi-Fi,
//! controls and debugs the terminal and updates its firmware, with or without the site. The
//! messages are in `matecrew_core::link` (protocol `link::PROTOCOL`).
//!
//! Security: what changes something (`SETUP`, `CONTROL`, `OTA`) needs an encrypted link
//! authenticated by passkey (LE Secure Connections, MITM protection). The passkey is new at
//! every boot and shown on the terminal (setup, link and about screens, and over any screen
//! while a pairing waits for it): the browser's system dialog asks for it, so only someone who
//! can read the panel gets in. Events, the log among
//! them, go to such a link only. Nothing is bonded: pairing again each session keeps the 24 KB
//! of NVS for settings. `SETUP` is refused once the terminal is linked to a site.
//!
//! A firmware update writes the other app slot as frames arrive (sequential erase, so no write
//! waits seconds), checks size, CRC-32 per frame and SHA-256 at the end, then restarts on it;
//! the bootloader goes back if the new firmware never confirms itself (`ota.rs`).
//!
//! Screen mirror: while a paired browser is subscribed to `SCREEN`, the notifier thread sends it
//! the panel as it changes, the whole screen first, then the changed rows (`link::screen_update`,
//! run-length coded: a few KB a screen). The screen loop only hands each new frame over
//! (`show_screen`). Notifications are numbered: a browser that misses one asks for the whole
//! screen again.

use anyhow::{anyhow, Result};
use esp32_nimble::{
    enums::{AuthReq, SecurityIOCap},
    utilities::BleUuid,
    BLEAdvertisementData, BLEDevice, NimbleProperties,
};
use esp_idf_svc::{
    hal::reset,
    log::{EspIdfLogFilter, EspIdfLogger},
    sys,
};
use matecrew_core::{
    contract::normalize_uid,
    flow::Event as FlowEvent,
    link::{self, Control, Event, OtaFrame, ScreenRequest, Setup},
};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering},
        mpsc::Sender,
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use crate::{
    store::{Store, WifiCredentials},
    Input,
};

/// Events waiting for the notifier; the oldest go when it is full.
static OUTBOX: Mutex<VecDeque<Event>> = Mutex::new(VecDeque::new());
const OUTBOX_MAX: usize = 64;
/// A browser that paired with the passkey is connected: events are worth sending.
static TRUSTED: AtomicBool = AtomicBool::new(false);
/// A browser is connected, paired or not: the status bar shows it.
static CONNECTED: AtomicBool = AtomicBool::new(false);
/// A pairing waits for the passkey: the terminal shows it over its screen until it ends.
static PAIRING: AtomicBool = AtomicBool::new(false);
static PASSKEY: AtomicU32 = AtomicU32::new(0);
/// The link's ATT MTU; a notification carries 3 bytes less.
static MTU: AtomicU16 = AtomicU16::new(23);
/// The connection notifications go to.
static CONN: AtomicU16 = AtomicU16::new(0);
/// The browser is subscribed to `EVENTS`, to `SCREEN`.
static EVENTS_ON: AtomicBool = AtomicBool::new(false);
static WATCHING: AtomicBool = AtomicBool::new(false);
/// The browser asked for the whole screen (it starts watching, or missed a notification).
static WHOLE: AtomicBool = AtomicBool::new(false);
/// The panel's latest frame, and whether the mirror has taken it yet.
static PANEL: Mutex<Panel> = Mutex::new(Panel { bits: Vec::new(), fresh: false });
/// Networks the setup scan heard, for `INFO`.
static NETWORKS: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// The firmware update being written, if any.
static UPDATE: Mutex<Option<Update>> = Mutex::new(None);

/// ATT application error answered to a write the terminal refuses (0x80..=0x9F).
const REFUSED: u8 = 0x80;
/// NimBLE buffers the screen mirror leaves free for events and write answers (36 in all; a full
/// notification takes two or three): it waits rather than starve them.
const MIRROR_SPARE: i32 = 8;
/// How long a notification may wait for buffers before the link counts as stuck.
const NOTIFY_PATIENCE: Duration = Duration::from_secs(2);

struct Panel {
    bits: Vec<u8>,
    fresh: bool,
}

/// Who the terminal is, for `INFO`.
pub struct Identity {
    pub name: String,
    pub hardware_id: String,
    pub firmware: link::Firmware,
}

/// The link once advertising: its name and this boot's passkey, for the screens.
pub struct Ble {
    pub name: String,
    pub passkey: u32,
}

impl Ble {
    /// "matecrew-50E4 · 123456".
    pub fn label(&self) -> String {
        format!("{} · {:06}", self.name, self.passkey)
    }
}

/// Whether a browser is connected, and whether it paired with the passkey.
pub fn linked() -> (bool, bool) {
    (CONNECTED.load(Ordering::Relaxed), TRUSTED.load(Ordering::Relaxed))
}

/// The passkey while a pairing waits for it.
pub fn pairing() -> Option<u32> {
    PAIRING.load(Ordering::Relaxed).then(|| PASSKEY.load(Ordering::Relaxed))
}

/// The terminal's log, to the serial port as before and to a paired browser.
pub fn init_logging() {
    static ESP: EspIdfLogger<EspIdfLogFilter> = EspIdfLogger::new(EspIdfLogFilter::new());
    struct Tee;
    impl log::Log for Tee {
        fn enabled(&self, metadata: &log::Metadata) -> bool {
            ESP.enabled(metadata)
        }
        fn log(&self, record: &log::Record) {
            // esp32-nimble warns of each GAP event it leaves to the stack (MTU, PHY, data length).
            if record.target() == "esp32_nimble::server::ble_server" && record.args().to_string().starts_with("unhandled event") {
                return;
            }
            ESP.log(record);
            // The BLE stack's own lines would loop through a failing notification.
            let target = record.target();
            if ESP.enabled(record.metadata()) && !target.starts_with("esp32_nimble") && !target.starts_with("NimBLE") {
                let level = match record.level() {
                    log::Level::Error => 'E',
                    log::Level::Warn => 'W',
                    log::Level::Info => 'I',
                    log::Level::Debug => 'D',
                    log::Level::Trace => 'V',
                };
                let target = target.rsplit("::").next().unwrap_or(target).to_owned();
                send(Event::Log { level, target, msg: record.args().to_string() });
            }
        }
        fn flush(&self) {}
    }
    static TEE: Tee = Tee;
    if log::set_logger(&TEE).is_ok() {
        ESP.filter().initialize();
    }
}

/// Queues an event for the paired browser, if one listens.
pub fn send(event: Event) {
    if !TRUSTED.load(Ordering::Relaxed) {
        return;
    }
    if let Ok(mut outbox) = OUTBOX.lock() {
        if outbox.len() >= OUTBOX_MAX {
            outbox.pop_front();
        }
        outbox.push_back(event);
    }
}

/// A new frame on the panel, from the screen loop: a copy for the screen mirror, sent from the
/// notifier thread if a browser watches.
pub fn show_screen(bits: &[u8]) {
    if let Ok(mut panel) = PANEL.lock() {
        panel.bits.clear();
        panel.bits.extend_from_slice(bits);
        panel.fresh = true;
    }
}

/// The networks the setup scan heard, strongest first.
pub fn set_networks(networks: Vec<String>) {
    if let Ok(mut known) = NETWORKS.lock() {
        *known = networks;
    }
}

fn uuid(text: &str) -> BleUuid {
    BleUuid::from_uuid128_string(text).expect("a protocol UUID")
}

/// Starts advertising the link service. `inputs` gets what a browser asks once the terminal runs.
pub fn start(store: Store, inputs: Sender<Input>, identity: Identity) -> Result<Ble> {
    let ble = Ble {
        name: identity.name.clone(),
        // SAFETY: plain hardware random number.
        passkey: unsafe { sys::esp_random() } % 1_000_000,
    };
    let started = Instant::now();
    let store = Arc::new(Mutex::new(store));
    let identity = Arc::new(identity);

    let device = BLEDevice::take();
    BLEDevice::set_device_name(&ble.name).map_err(|e| anyhow!("ble name: {e:?}"))?;
    device
        .security()
        .set_auth(AuthReq::Mitm | AuthReq::Sc)
        .set_passkey(ble.passkey)
        .set_io_cap(SecurityIOCap::DisplayOnly);
    let _ = device.set_preferred_mtu(517);
    // NimBLE logs each notification at INFO: the screen mirror would flood the serial port.
    // SAFETY: a static tag and a level.
    unsafe { sys::esp_log_level_set(c"NimBLE".as_ptr(), sys::esp_log_level_t_ESP_LOG_WARN) };

    PASSKEY.store(ble.passkey, Ordering::Relaxed);

    let server = device.get_server();
    server.advertise_on_disconnect(true);
    // Each change of the link redraws the screen: its status bar icon, the pairing card.
    let changed = inputs.clone();
    server.on_connect(move |_, desc| {
        MTU.store(desc.mtu(), Ordering::Relaxed);
        CONN.store(desc.conn_handle(), Ordering::Relaxed);
        CONNECTED.store(true, Ordering::Relaxed);
        let _ = changed.send(Input::Bluetooth);
        log::info!("ble: connected");
    });
    let changed = inputs.clone();
    let passkey = ble.passkey;
    server.on_passkey_request(move || {
        PAIRING.store(true, Ordering::Relaxed);
        let _ = changed.send(Input::Bluetooth);
        log::info!("ble: pairing, showing the passkey");
        passkey
    });
    let changed = inputs.clone();
    server.on_authentication_complete(move |_, desc, result| {
        let trusted = result.is_ok() && desc.encrypted() && desc.authenticated();
        MTU.store(desc.mtu(), Ordering::Relaxed);
        TRUSTED.store(trusted, Ordering::Relaxed);
        PAIRING.store(false, Ordering::Relaxed);
        let _ = changed.send(Input::Bluetooth);
        log::info!("ble: paired {}", if trusted { "with the passkey" } else { "without it, nothing allowed" });
    });
    let changed = inputs.clone();
    server.on_disconnect(move |_, _| {
        TRUSTED.store(false, Ordering::Relaxed);
        CONNECTED.store(false, Ordering::Relaxed);
        PAIRING.store(false, Ordering::Relaxed);
        EVENTS_ON.store(false, Ordering::Relaxed);
        WATCHING.store(false, Ordering::Relaxed);
        let _ = changed.send(Input::Bluetooth);
        if let Ok(mut outbox) = OUTBOX.lock() {
            outbox.clear();
        }
        abort_update();
        log::info!("ble: disconnected");
    });

    let service = server.create_service(uuid(link::SERVICE));

    let info = service.lock().create_characteristic(uuid(link::INFO), NimbleProperties::READ);
    {
        let (store, identity) = (store.clone(), identity.clone());
        info.lock().on_read(move |characteristic, _| {
            characteristic.set_value(&info_value(&identity, &store, started));
        });
    }

    let changes = NimbleProperties::WRITE | NimbleProperties::WRITE_ENC | NimbleProperties::WRITE_AUTHEN;
    let setup = service.lock().create_characteristic(uuid(link::SETUP), changes);
    {
        let store = store.clone();
        setup.lock().on_write(move |args| {
            MTU.store(args.desc().mtu(), Ordering::Relaxed);
            let done = apply_setup(&store, args.recv_data());
            if done.is_ok() {
                // Time for the answer to reach the browser, then start over on the new Wi-Fi.
                restart_in(Duration::from_millis(1500));
            } else {
                args.reject_with_error_code(REFUSED);
            }
            answer("setup", done);
        });
    }

    let taps = inputs.clone();
    let control = service.lock().create_characteristic(uuid(link::CONTROL), changes);
    control.lock().on_write(move |args| {
        MTU.store(args.desc().mtu(), Ordering::Relaxed);
        let done = apply_control(&inputs, args.recv_data());
        if done.is_err() {
            args.reject_with_error_code(REFUSED);
        }
        answer("control", done);
    });

    let events = service
        .lock()
        .create_characteristic(uuid(link::EVENTS), NimbleProperties::READ | NimbleProperties::NOTIFY);
    events.lock().on_subscribe(|_, _, how| EVENTS_ON.store(!how.is_empty(), Ordering::Relaxed));

    // Subscribing starts the mirror with the whole screen; a write asks for it again, or taps it.
    let screen = service.lock().create_characteristic(uuid(link::SCREEN), NimbleProperties::NOTIFY | changes);
    screen
        .lock()
        .on_subscribe(|_, _, how| {
            WATCHING.store(!how.is_empty(), Ordering::Relaxed);
            WHOLE.store(true, Ordering::Relaxed);
        })
        .on_write(move |args| match ScreenRequest::parse(args.recv_data()) {
            Ok(ScreenRequest::Whole) => WHOLE.store(true, Ordering::Relaxed),
            Ok(ScreenRequest::Tap { x, y }) => {
                let _ = taps.send(Input::Tap(x.into(), y.into()));
            }
            Err(_) => args.reject_with_error_code(REFUSED),
        });

    let ota = service.lock().create_characteristic(uuid(link::OTA), changes);
    {
        let store = store.clone();
        ota.lock().on_write(move |args| {
            MTU.store(args.desc().mtu(), Ordering::Relaxed);
            if let Err(e) = apply_ota(&store, args.recv_data()) {
                abort_update();
                send(Event::Ota { state: "failed".into(), done: 0, total: 0, error: Some(e) });
                args.reject_with_error_code(REFUSED);
            }
        });
    }

    let advertising = device.get_advertising();
    advertising
        .lock()
        .min_interval(320) // 200 ms, then up to 500 ms: found in a second, light on the battery
        .max_interval(800)
        .set_data(BLEAdvertisementData::new().name(&ble.name).add_service_uuid(uuid(link::SERVICE)))
        .map_err(|e| anyhow!("ble advertising: {e:?}"))?;
    advertising.lock().start().map_err(|e| anyhow!("ble advertising: {e:?}"))?;

    // Sends queued events one notification each, then what changed on the screen if the browser
    // watches it, as long as a paired browser is there.
    thread::Builder::new().stack_size(6 * 1024).spawn(move || {
        let mut handles = None;
        let mut mirror: Option<Mirror> = None;
        loop {
            thread::sleep(Duration::from_millis(30));
            if !TRUSTED.load(Ordering::Relaxed) {
                mirror = None;
                continue;
            }
            handles = handles.or_else(|| handle(link::EVENTS).zip(handle(link::SCREEN)));
            let Some((events, screen)) = handles else { continue };
            let batch: Vec<Event> = OUTBOX.lock().map(|mut outbox| outbox.drain(..).collect()).unwrap_or_default();
            for event in batch {
                if EVENTS_ON.load(Ordering::Relaxed) {
                    notify(events, &event.encode(room()), 0);
                }
            }
            if WATCHING.load(Ordering::Relaxed) {
                if mirror.is_none() {
                    log::info!("ble: mirroring the screen");
                }
                mirror.get_or_insert_with(Mirror::default).update(screen);
            } else {
                mirror = None;
            }
        }
    })?;

    log::info!("ble: advertising as {}", ble.name);
    Ok(ble)
}

/// What a notification carries on this link.
fn room() -> usize {
    usize::from(MTU.load(Ordering::Relaxed)).saturating_sub(3).clamp(20, link::ATTRIBUTE_MAX)
}

/// The value handle of a characteristic of the link service, once the GATT server runs.
fn handle(characteristic: &str) -> Option<u16> {
    let service = sys::ble_uuid_any_t::from(uuid(link::SERVICE));
    let wanted = sys::ble_uuid_any_t::from(uuid(characteristic));
    let mut handle = 0;
    // SAFETY: two UUIDs that outlive the call, and an out-parameter.
    let rc = unsafe { sys::ble_gatts_find_chr(&service.u, &wanted.u, core::ptr::null_mut(), &mut handle) };
    (rc == 0).then_some(handle)
}

/// One notification, straight to NimBLE: esp32-nimble's own `notify` holds the characteristic's
/// lock, and NimBLE reads the attribute through that lock when a buffer runs out. Waits while
/// fewer than `spare` buffers are free; false once the browser left or the link stays stuck.
fn notify(handle: u16, value: &[u8], spare: i32) -> bool {
    let deadline = Instant::now() + NOTIFY_PATIENCE;
    while TRUSTED.load(Ordering::Relaxed) && Instant::now() < deadline {
        // SAFETY: NimBLE copies `value` into a buffer of its own, which the notify consumes.
        let rc = unsafe {
            let om = if sys::os_msys_num_free() >= spare {
                sys::ble_hs_mbuf_from_flat(value.as_ptr().cast(), value.len() as u16)
            } else {
                core::ptr::null_mut()
            };
            if om.is_null() {
                sys::BLE_HS_ENOMEM as i32
            } else {
                sys::ble_gatts_notify_custom(CONN.load(Ordering::Relaxed), handle, om)
            }
        };
        match rc {
            0 => return true,
            rc if rc == sys::BLE_HS_ENOMEM as i32 => thread::sleep(Duration::from_millis(10)),
            _ => return false,
        }
    }
    false
}

/// The screen mirror to the browser: what it shows (`None`: send the whole screen), the frame
/// being sent, the notification being sent and the number of the next one.
#[derive(Default)]
struct Mirror {
    shown: Option<Vec<u8>>,
    next: Vec<u8>,
    notification: Vec<u8>,
    seq: u8,
}

impl Mirror {
    /// Sends what changed on the panel since the last update, if anything.
    fn update(&mut self, handle: u16) {
        if WHOLE.swap(false, Ordering::Relaxed) {
            self.shown = None;
        }
        let due = PANEL.lock().is_ok_and(|mut panel| {
            let due = !panel.bits.is_empty() && (panel.fresh || self.shown.is_none());
            if due {
                self.next.clear();
                self.next.extend_from_slice(&panel.bits);
                panel.fresh = false;
            }
            due
        });
        let (width, height) = (matecrew_ui::WIDTH as u16, matecrew_ui::HEIGHT as u16);
        let Some(update) = due.then(|| link::screen_update(self.shown.as_deref(), &self.next, width, height)).flatten() else {
            return;
        };
        let room = room();
        let mut index = 0;
        while link::screen_notification(&update, room, index, self.seq, &mut self.notification) {
            self.seq = self.seq.wrapping_add(1);
            index += 1;
            if !notify(handle, &self.notification, MIRROR_SPARE) {
                // The browser misses the end of it: the whole screen goes next.
                self.shown = None;
                return;
            }
        }
        match &mut self.shown {
            Some(shown) => core::mem::swap(shown, &mut self.next),
            None => self.shown = Some(core::mem::take(&mut self.next)),
        }
    }
}

fn answer(op: &str, done: Result<(), String>) {
    if let Err(e) = &done {
        log::warn!("ble: {op} refused: {e}");
    }
    send(Event::Done { op: op.into(), ok: done.is_ok(), error: done.err() });
}

fn restart_in(delay: Duration) {
    let _ = thread::Builder::new().stack_size(2048).spawn(move || {
        thread::sleep(delay);
        reset::restart();
    });
}

fn info_value(identity: &Identity, store: &Mutex<Store>, started: Instant) -> Vec<u8> {
    let (linked, site, wifi) = match store.lock() {
        Ok(store) => (
            store.token().ok().flatten().is_some(),
            store.site().ok().flatten(),
            store.wifi().ok().flatten(),
        ),
        Err(_) => (false, None, None),
    };
    // SAFETY: plain heap statistics query.
    let heap = unsafe { sys::heap_caps_get_free_size(sys::MALLOC_CAP_INTERNAL | sys::MALLOC_CAP_8BIT) } as u32;
    link::Info {
        protocol: link::PROTOCOL,
        name: identity.name.clone(),
        hardware_id: identity.hardware_id.clone(),
        firmware: identity.firmware.clone(),
        linked,
        setup_open: !linked,
        site,
        uptime: started.elapsed().as_secs(),
        heap,
        wifi: wifi.map(|creds| link::Wifi { ssid: creds.ssid, rssi: crate::wifi::rssi() }),
        networks: NETWORKS.lock().map(|n| n.clone()).unwrap_or_default(),
    }
    .encode()
}

/// Wi-Fi, site and link secret from a browser, while the terminal is not linked.
fn apply_setup(store: &Mutex<Store>, bytes: &[u8]) -> Result<(), String> {
    let setup = Setup::parse(bytes).map_err(|e| e.to_string())?;
    let store = store.lock().map_err(|_| "busy".to_owned())?;
    if store.token().map_err(|e| e.to_string())?.is_some() {
        return Err("already linked to a site".into());
    }
    let site = match &setup.site {
        Some(site) => Some(crate::api::normalize_site(site).ok_or("not a web address")?),
        None => None,
    };
    let save = || -> anyhow::Result<()> {
        store.set_wifi(&WifiCredentials { ssid: setup.ssid.clone(), password: setup.password.clone() })?;
        if let Some(site) = &site {
            store.set_site(site)?;
        }
        store.set_link_secret(setup.secret.as_deref())?;
        store.set_wifi_failures(0)?;
        Ok(())
    };
    save().map_err(|e| e.to_string())?;
    log::info!("ble: Wi-Fi {:?} saved{}", setup.ssid, if setup.secret.is_some() { " with a pre-approved link" } else { "" });
    Ok(())
}

fn apply_control(inputs: &Sender<Input>, bytes: &[u8]) -> Result<(), String> {
    let input = match Control::parse(bytes).map_err(|e| e.to_string())? {
        Control::Key { side } => Input::Flow(FlowEvent::Key { side }),
        Control::Both => Input::Flow(FlowEvent::BothKeys),
        Control::Badge { uid } => Input::Flow(FlowEvent::Badge { uid: normalize_uid(&uid).ok_or("not a badge UID")? }),
        Control::Sync => Input::Sync,
        Control::Notify { text } => Input::Notify(text),
        Control::Restart => {
            restart_in(Duration::from_millis(500));
            return Ok(());
        }
    };
    inputs.send(input).map_err(|_| "the terminal stopped".to_owned())
}

/// A firmware update in progress: ESP-IDF's handle on the other slot and what came so far.
struct Update {
    handle: sys::esp_ota_handle_t,
    partition: *const sys::esp_partition_t,
    size: u32,
    written: u32,
    hasher: Sha256,
    sha256: [u8; 32],
    /// Last progress sent, in 2 % steps.
    reported: u32,
}

// SAFETY: the partition pointer is into ESP-IDF's static partition table.
unsafe impl Send for Update {}

fn abort_update() {
    if let Some(update) = UPDATE.lock().ok().and_then(|mut u| u.take()) {
        // SAFETY: a handle from esp_ota_begin, not ended yet.
        unsafe { sys::esp_ota_abort(update.handle) };
        log::warn!("ble: firmware update abandoned at {} of {} bytes", update.written, update.size);
    }
}

fn apply_ota(store: &Mutex<Store>, bytes: &[u8]) -> Result<(), String> {
    match OtaFrame::parse(bytes).map_err(|e| e.to_string())? {
        OtaFrame::Begin { size, sha256, version } => {
            abort_update();
            // SAFETY: plain partition table queries and the start of an OTA write.
            let update = unsafe {
                let partition = sys::esp_ota_get_next_update_partition(core::ptr::null());
                if partition.is_null() {
                    return Err("no update slot".into());
                }
                if size == 0 || size > (*partition).size {
                    return Err(format!("{size} bytes do not fit the {}-byte slot", (*partition).size));
                }
                let mut handle: sys::esp_ota_handle_t = 0;
                // Sequential writes: each sector is erased as it is reached, not all up front.
                let rc = sys::esp_ota_begin(partition, sys::OTA_WITH_SEQUENTIAL_WRITES as usize, &mut handle);
                if rc != sys::ESP_OK {
                    return Err(format!("esp_ota_begin {rc}"));
                }
                Update { handle, partition, size, written: 0, hasher: Sha256::new(), sha256, reported: 0 }
            };
            *UPDATE.lock().map_err(|_| "busy")? = Some(update);
            log::info!("ble: firmware update {version} of {size} bytes");
            send(Event::Ota { state: "ready".into(), done: 0, total: size, error: None });
            Ok(())
        }
        OtaFrame::Data { offset, bytes } => {
            let mut guard = UPDATE.lock().map_err(|_| "busy")?;
            let update = guard.as_mut().ok_or("no update begun")?;
            if offset != update.written {
                return Err(format!("data at {offset}, {} expected", update.written));
            }
            if update.written as usize + bytes.len() > update.size as usize {
                return Err("more data than announced".into());
            }
            // SAFETY: a live OTA handle and a valid buffer.
            let rc = unsafe { sys::esp_ota_write(update.handle, bytes.as_ptr().cast(), bytes.len()) };
            if rc != sys::ESP_OK {
                return Err(format!("esp_ota_write {rc}"));
            }
            update.hasher.update(bytes);
            update.written += bytes.len() as u32;
            let step = (u64::from(update.written) * 50 / u64::from(update.size)) as u32;
            if step > update.reported {
                update.reported = step;
                send(Event::Ota { state: "writing".into(), done: update.written, total: update.size, error: None });
            }
            Ok(())
        }
        OtaFrame::End => {
            let update = UPDATE.lock().map_err(|_| "busy")?.take().ok_or("no update begun")?;
            let fail = |e: String| {
                // SAFETY: a handle from esp_ota_begin, not ended yet.
                unsafe { sys::esp_ota_abort(update.handle) };
                Err(e)
            };
            if update.written != update.size {
                return fail(format!("{} bytes written, {} announced", update.written, update.size));
            }
            if update.hasher.clone().finalize().as_slice() != update.sha256 {
                return fail("SHA-256 does not match".into());
            }
            // SAFETY: ends the OTA write (ESP-IDF checks the image) and makes the slot boot next.
            let version = unsafe {
                let rc = sys::esp_ota_end(update.handle);
                if rc != sys::ESP_OK {
                    return Err(format!("not a valid image ({rc})"));
                }
                let rc = sys::esp_ota_set_boot_partition(update.partition);
                if rc != sys::ESP_OK {
                    return Err(format!("esp_ota_set_boot_partition {rc}"));
                }
                let mut description = sys::esp_app_desc_t::default();
                (sys::esp_ota_get_partition_description(update.partition, &mut description) == sys::ESP_OK)
                    .then(|| core::ffi::CStr::from_ptr(description.version.as_ptr()).to_string_lossy().into_owned())
            };
            // As after a download (`ota.rs`): the new version starts pending and confirms itself.
            if let (Some(version), Ok(store)) = (&version, store.lock()) {
                let _ = store.set_ota_pending(Some(version));
            }
            log::info!("ble: firmware {} written, restarting on it", version.as_deref().unwrap_or("?"));
            send(Event::Ota { state: "done".into(), done: update.size, total: update.size, error: None });
            restart_in(Duration::from_millis(1500));
            Ok(())
        }
        OtaFrame::Abort => {
            abort_update();
            Ok(())
        }
    }
}
