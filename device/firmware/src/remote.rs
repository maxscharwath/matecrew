//! The site's console and the realtime relay: commands from the console, the panel's mirror, and
//! "what you show changed".
//!
//! With a relay (`DeviceState::realtime`), all of it goes through one WebSocket (`socket`) the
//! terminal keeps open: a command arrives in tens of milliseconds, the screen goes as the rows that
//! changed, the site says when to sync, and nothing is polled. A heartbeat every 30 s, answered by
//! the relay without waking it, keeps the connection and the office's NAT open.
//!
//! Without one, or while it cannot be reached, as before: a long poll for commands and the screen
//! uploaded over HTTP. Two threads either way, as before: `downlink` (the socket, or the long
//! poll) and `uplink` (the screen, the log while a console watches, the beeps). What the terminal
//! shows and says reaches this module through `viewers`, like Bluetooth.

use anyhow::Result;
use matecrew_core::{
    action::Action,
    flow::Event as FlowEvent,
    link::Event,
    live::{self, changed_rows, command_id, patch, FromTerminal, Status, ToTerminal},
};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{self, Sender},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use crate::{
    api::{Api, Unauthorized},
    socket::{Message, Refused, Socket},
    Input,
};

/// Connecting: DNS, TCP, TLS (a second or more on the ESP32) and the upgrade.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const SEND_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a read waits for the rest of a message once it started.
const READ_TIMEOUT: Duration = Duration::from_secs(5);
/// How often the downlink looks up from waiting for data: heartbeat, address change.
const LOOK_EVERY: Duration = Duration::from_millis(500);
/// Reconnections back off up to this; the long poll covers the time in between.
const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// The longest long poll the site holds.
const LONG_POLL_MAX: Duration = Duration::from_secs(25);
/// Log lines and beeps waiting for the uplink; more are dropped rather than held.
const TEXT_QUEUE_MAX: usize = 64;

/// The terminal's side of the live channel, shared by the threads that use it. Cheap to clone.
#[derive(Clone)]
pub struct Live(Arc<Shared>);

struct Shared {
    token: String,
    /// Where the relay is, from the last state; `None` without one.
    url: Mutex<Option<String>>,
    /// The open socket, for whoever sends.
    socket: Mutex<Option<Arc<Socket>>>,
    /// The last report, sent again with each connection's hello.
    status: Mutex<Status>,
    /// The screen the relay has from this connection: patches start from it.
    relayed: Mutex<Option<Vec<u8>>>,
}

impl Live {
    pub fn new(token: String, status: Status) -> Self {
        Self(Arc::new(Shared {
            token,
            url: Mutex::new(None),
            socket: Mutex::new(None),
            status: Mutex::new(status),
            relayed: Mutex::new(None),
        }))
    }

    /// The relay from the last state; a different one closes the socket and opens the new one.
    pub fn set_url(&self, url: Option<String>) {
        if let Ok(mut current) = self.0.url.lock() {
            if *current != url {
                log::info!("relay: {}", url.as_deref().unwrap_or("none, polling the site"));
                *current = url;
            }
        }
    }

    fn url(&self) -> Option<String> {
        self.0.url.lock().ok().and_then(|url| url.clone())
    }

    pub fn connected(&self) -> bool {
        self.socket().is_some()
    }

    fn socket(&self) -> Option<Arc<Socket>> {
        self.0.socket.lock().ok().and_then(|socket| socket.clone())
    }

    /// What the terminal says about itself after a sync: kept, and sent now when connected.
    pub fn report(&self, status: Status) {
        if let Some(socket) = self.socket() {
            let _ = socket.send_text(&FromTerminal::Status { status: &status }.json(), SEND_TIMEOUT);
        }
        if let Ok(mut kept) = self.0.status.lock() {
            *kept = status;
        }
    }

    /// The rows of `frame` the relay does not have yet; false when it cannot take them now.
    fn send_screen(&self, frame: &[u8]) -> bool {
        let Some(socket) = self.socket() else { return false };
        let Ok(mut relayed) = self.0.relayed.lock() else { return false };
        let Some((y, rows)) = changed_rows(relayed.as_deref(), frame) else { return true };
        match socket.send_binary(patch(frame, y, rows), SEND_TIMEOUT) {
            Ok(()) => {
                *relayed = Some(frame.to_vec());
                true
            }
            Err(e) => {
                log::warn!("relay screen: {e:#}");
                *relayed = None;
                false
            }
        }
    }
}

/// What the uplink sends: the panel's latest screen (`LATEST`), or a text message (a log line,
/// a beep).
enum Up {
    Screen,
    Text(String),
}

static UPLINK: OnceLock<(Live, Mutex<Sender<Up>>)> = OnceLock::new();
static TEXTS_QUEUED: AtomicUsize = AtomicUsize::new(0);
/// The panel's latest screen, copied in at each new one (no allocation), read when it goes.
static LATEST: Mutex<Vec<u8>> = Mutex::new(Vec::new());
/// A console watches: the screen goes, and the log over the relay.
static WATCHED: AtomicBool = AtomicBool::new(false);

/// Hands `up` to the uplink thread; with `wait` false, gives up rather than wait for the lock.
fn queue(up: Up, wait: bool) -> bool {
    let Some((_, uplink)) = UPLINK.get() else { return false };
    let sender = if wait { uplink.lock().ok() } else { uplink.try_lock().ok() };
    sender.is_some_and(|sender| sender.send(up).is_ok())
}

/// A text message for the relay when connected (and while a console watches, with
/// `watching_only`). Never blocks.
fn queue_text(watching_only: bool, message: impl FnOnce() -> String) {
    let Some((live, _)) = UPLINK.get() else { return };
    if (watching_only && !WATCHED.load(Ordering::Relaxed))
        || !live.connected()
        || TEXTS_QUEUED.load(Ordering::Relaxed) >= TEXT_QUEUE_MAX
    {
        return;
    }
    if queue(Up::Text(message()), false) {
        TEXTS_QUEUED.fetch_add(1, Ordering::Relaxed);
    }
}

/// An event for the consoles over the relay, in the same JSON as over Bluetooth (`link::Event`):
/// the log while a console watches, the beeps whenever connected (a console with the screen over
/// Bluetooth still hears them); Bluetooth's own answers stay there. Never blocks, never logs:
/// called from the logger and the buzzer, on any thread (`viewers::publish`).
pub fn publish(event: &Event) {
    match event {
        // This module's own lines would loop through a failing send.
        Event::Log { target, .. } if target == "remote" || target == "socket" => {}
        Event::Log { .. } => queue_text(true, || serde_json::to_string(event).unwrap_or_default()),
        Event::Beep { .. } => queue_text(false, || serde_json::to_string(event).unwrap_or_default()),
        Event::Done { .. } | Event::Ota { .. } => {}
    }
}

/// A new screen on the panel (`viewers::screen`): kept, and sent while a console watches.
pub fn screen(bits: &[u8]) {
    if let Ok(mut latest) = LATEST.lock() {
        latest.clear();
        latest.extend_from_slice(bits);
    }
    if WATCHED.load(Ordering::Relaxed) {
        queue(Up::Screen, true);
    }
}

/// Whether a console watches; when one just started, the screen goes now.
fn watched(watching: bool) {
    if watching && !WATCHED.swap(true, Ordering::Relaxed) {
        queue(Up::Screen, true);
    } else if !watching {
        WATCHED.store(false, Ordering::Relaxed);
    }
}

/// Starts both threads.
pub fn start(api: Api, live: Live, inputs: Sender<Input>) -> Result<()> {
    uplink(api.clone(), live.clone())?;
    let downlink = Downlink { api, live, inputs };
    thread::Builder::new().stack_size(10 * 1024).spawn(move || downlink.run())?;
    Ok(())
}

/// What a console's action does on the terminal, whichever way it came (the relay, the long
/// poll, Bluetooth).
pub fn input(action: Action) -> Input {
    match action {
        Action::Key(side) => Input::Flow(FlowEvent::Key { side }),
        Action::Both => Input::Flow(FlowEvent::BothKeys),
        Action::Badge(uid) => Input::Flow(FlowEvent::Badge { uid }),
        Action::Sync => Input::Sync,
        Action::App(app) => Input::SelectApp(app),
        Action::Tap { x, y } => Input::Tap(x, y),
        Action::Restart => Input::Restart,
        Action::ForgetWifi => Input::ForgetWifi,
        Action::Notify(text) => Input::Notify(text),
    }
}

struct Downlink {
    api: Api,
    live: Live,
    inputs: Sender<Input>,
}

impl Downlink {
    /// The relay's socket when there is one; the site's long poll otherwise, and between
    /// reconnections. Returns when the main loop is gone.
    fn run(self) {
        let mut failures = 0u32;
        let mut retry_at = Instant::now();
        loop {
            let url = self.live.url();
            if let Some(url) = url.as_deref().filter(|_| Instant::now() >= retry_at) {
                match Socket::connect(url, &self.live.0.token, live::SUBPROTOCOL, CONNECT_TIMEOUT) {
                    Ok(socket) => {
                        failures = 0;
                        if !self.session(socket, url) {
                            return;
                        }
                        continue;
                    }
                    Err(e) => {
                        log::warn!("relay: {e:#}");
                        // The relay does not know the token: the site says whether it is unlinked.
                        if e.downcast_ref::<Refused>().is_some_and(|r| r.0 == 401) && self.inputs.send(Input::Sync).is_err() {
                            return;
                        }
                        failures += 1;
                        retry_at = Instant::now() + MAX_BACKOFF.min(Duration::from_millis(500 << failures.min(7)));
                    }
                }
            }
            // A relay to try again soon: wait for it rather than start a long poll.
            let until_retry = retry_at.saturating_duration_since(Instant::now());
            if url.is_some() && until_retry < Duration::from_secs(2) {
                thread::sleep(until_retry);
                continue;
            }
            let wait = if url.is_some() { until_retry.min(LONG_POLL_MAX) } else { LONG_POLL_MAX };
            if !self.poll(wait) {
                return;
            }
        }
    }

    /// One connection, until it ends. False when the main loop is gone.
    fn session(&self, socket: Socket, url: &str) -> bool {
        let socket = Arc::new(socket);
        if let Ok(mut relayed) = self.live.0.relayed.lock() {
            *relayed = None;
        }
        let hello = self.live.0.status.lock().map(|status| FromTerminal::Hello { status: &status }.json());
        if let Err(e) = hello.map_err(|_| anyhow::anyhow!("status lock")).and_then(|hello| socket.send_text(&hello, SEND_TIMEOUT)) {
            log::warn!("relay hello: {e:#}");
            return true;
        }
        if let Ok(mut open) = self.live.0.socket.lock() {
            *open = Some(socket.clone());
        }
        log::info!("relay: connected");
        let mut alive = self.inputs.send(Input::Live(true)).is_ok();
        let mut pinged = Instant::now();
        let mut awaiting: Option<Instant> = None;
        while alive {
            if self.live.url().as_deref() != Some(url) {
                break;
            }
            if awaiting.is_some_and(|at| at.elapsed() > Duration::from_millis(live::PONG_WITHIN_MS)) {
                log::warn!("relay: no answer to the heartbeat, reconnecting");
                break;
            }
            if pinged.elapsed() >= Duration::from_millis(live::PING_EVERY_MS) {
                if let Err(e) = socket.send_text(live::PING, SEND_TIMEOUT) {
                    log::warn!("relay heartbeat: {e:#}");
                    break;
                }
                pinged = Instant::now();
                awaiting.get_or_insert(pinged);
            }
            match socket.readable(LOOK_EVERY) {
                Ok(false) => continue,
                Ok(true) => {}
                Err(e) => {
                    log::warn!("{e:#}");
                    break;
                }
            }
            match socket.read(READ_TIMEOUT) {
                Ok(Some(Message::Text(text))) if text == live::PONG => awaiting = None,
                Ok(Some(Message::Text(text))) => alive = self.handle(&socket, live::parse(&text)),
                Ok(Some(Message::Ping(payload))) => {
                    if socket.pong(payload, SEND_TIMEOUT).is_err() {
                        break;
                    }
                }
                Ok(Some(Message::Close)) => {
                    log::info!("relay: closed by the relay");
                    break;
                }
                Ok(_) => {}
                Err(e) => {
                    log::warn!("relay: {e:#}");
                    break;
                }
            }
        }
        if let Ok(mut open) = self.live.0.socket.lock() {
            *open = None;
        }
        watched(false);
        log::info!("relay: disconnected");
        alive && self.inputs.send(Input::Live(false)).is_ok()
    }

    /// One message from the relay. False when the main loop is gone.
    fn handle(&self, socket: &Socket, message: ToTerminal) -> bool {
        match message {
            ToTerminal::Command { command } => {
                crate::net::pulse(false);
                log::info!("console: {command:?}");
                let id = command_id(&command).map(str::to_owned);
                if let Some(action) = Action::from_command(command) {
                    if self.inputs.send(input(action)).is_err() {
                        return false;
                    }
                }
                if let Some(id) = id {
                    let _ = socket.send_text(&FromTerminal::Ack { id: &id }.json(), SEND_TIMEOUT);
                }
            }
            ToTerminal::Live { watching } => watched(watching),
            ToTerminal::Sync { at } => return self.inputs.send(Input::Changed(at)).is_ok(),
            ToTerminal::Unknown => {}
        }
        true
    }

    /// One long poll of the site's console commands, up to `wait`. False when the main loop is gone.
    fn poll(&self, wait: Duration) -> bool {
        let reply = match self.api.commands(wait.as_secs()) {
            Ok(reply) => reply,
            Err(e) => {
                log::warn!("console commands: {e:#}");
                // Unlinked on the site: a sync now finds out and links again,
                // instead of at the next scheduled one.
                if e.is::<Unauthorized>() && self.inputs.send(Input::Sync).is_err() {
                    return false;
                }
                thread::sleep(Duration::from_secs(10).min(wait.max(Duration::from_secs(1))));
                return true;
            }
        };
        watched(reply.live);
        for command in reply.commands {
            log::info!("console: {command:?}");
            if let Some(action) = Action::from_command(command) {
                if self.inputs.send(input(action)).is_err() {
                    return false;
                }
            }
        }
        true
    }
}

/// The status bar's rows in a packed frame (56 px of 800 / 8 bytes): the clock and the arrows.
const STATUS_BYTES: usize = 56 * 800 / 8;
/// How often a change in the status bar alone is sent.
const STATUS_EVERY: Duration = Duration::from_secs(30);

/// Sends the screen while a console watches, over the relay when connected (the rows that
/// changed), else uploaded to the site; when several pile up, only the latest goes. Also sends the
/// text messages (`queue_text`).
fn uplink(api: Api, relay: Live) -> Result<()> {
    let (up, received) = mpsc::channel::<Up>();
    let _ = UPLINK.set((relay.clone(), Mutex::new(up)));
    thread::Builder::new().stack_size(10 * 1024).spawn(move || {
        let mut sent = true;
        let mut uploaded: Option<Vec<u8>> = None;
        let mut status_uploaded: Option<Instant> = None;
        while let Ok(message) = received.recv() {
            for message in std::iter::once(message).chain(received.try_iter()) {
                match message {
                    Up::Screen => sent = false,
                    Up::Text(text) => {
                        TEXTS_QUEUED.fetch_sub(1, Ordering::Relaxed);
                        if let Some(socket) = relay.socket() {
                            let _ = socket.send_text(&text, SEND_TIMEOUT);
                        }
                    }
                }
            }
            if sent || !WATCHED.load(Ordering::Relaxed) {
                continue;
            }
            let Some(frame) = LATEST.lock().ok().map(|latest| latest.clone()).filter(|f| !f.is_empty()) else {
                continue;
            };
            // Uploading over HTTP lights the status bar's network arrow, which changes the
            // screen, which uploads again: a change in the status bar alone goes at most every
            // STATUS_EVERY; the next one elsewhere carries it.
            let status_only = uploaded.as_ref().is_some_and(|before| before[STATUS_BYTES..] == frame[STATUS_BYTES..]);
            if status_only && status_uploaded.is_some_and(|at| at.elapsed() < STATUS_EVERY) {
                continue;
            }
            let done = relay.send_screen(&frame)
                || (!relay.connected() && api.put_frame(&frame).inspect_err(|e| log::warn!("screen mirror: {e:#}")).is_ok());
            if done {
                sent = true;
                uploaded = Some(frame);
                if status_only {
                    status_uploaded = Some(Instant::now());
                }
            }
        }
    })?;
    Ok(())
}
