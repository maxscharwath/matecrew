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
//! poll) and `uplink` (the screen, and the log while a console watches).

use anyhow::Result;
use matecrew_core::{
    contract::{normalize_uid, Command},
    flow::Event,
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
/// Log lines waiting for the uplink; more are dropped rather than held.
const LOG_QUEUE_MAX: usize = 64;

/// The terminal's side of the live channel, shared by the threads that use it. Cheap to clone.
#[derive(Clone)]
pub struct Live(Arc<Shared>);

struct Shared {
    token: String,
    /// Where the relay is, from the last state; `None` without one.
    url: Mutex<Option<String>>,
    /// The open socket, for whoever sends.
    socket: Mutex<Option<Arc<Socket>>>,
    /// A console wants the screen and the log.
    watching: AtomicBool,
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
            watching: AtomicBool::new(false),
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

/// What the uplink sends: a new frame (`None` to send the latest again), or a log line.
enum Up {
    Frame(Option<Vec<u8>>),
    Log(String),
}

static LOGS: OnceLock<(Live, Mutex<Sender<Up>>)> = OnceLock::new();
static LOGS_QUEUED: AtomicUsize = AtomicUsize::new(0);

/// A line of the terminal's log, for a console watching over the relay. Never blocks, never
/// logs: called from the logger, on any thread.
pub fn log_line(level: char, target: &str, message: &str) {
    // This module's own lines would loop through a failing send.
    if target == "remote" || target == "socket" {
        return;
    }
    let Some((live, uplink)) = LOGS.get() else { return };
    if !live.0.watching.load(Ordering::Relaxed) || !live.connected() || LOGS_QUEUED.load(Ordering::Relaxed) >= LOG_QUEUE_MAX {
        return;
    }
    let line = format!("{level} {target} {message}");
    if let Ok(uplink) = uplink.try_lock() {
        if uplink.send(Up::Log(FromTerminal::Log { line: &line }.json())).is_ok() {
            LOGS_QUEUED.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// Starts both threads; the mirror takes the screen loop's frames.
pub fn start(api: Api, live: Live, inputs: Sender<Input>) -> Result<Mirror> {
    let mirror = Mirror::start(api.clone(), live.clone())?;
    let downlink = Downlink { api, live, inputs, mirror: mirror.clone() };
    thread::Builder::new().stack_size(10 * 1024).spawn(move || downlink.run())?;
    Ok(mirror)
}

/// What a console command does on the terminal; `None` for one it cannot run.
fn input_of(command: Command) -> Option<Input> {
    Some(match command {
        Command::Key { side, .. } => Input::Flow(Event::Key { side }),
        Command::Both { .. } => Input::Flow(Event::BothKeys),
        Command::Badge { uid, .. } => Input::Flow(Event::Badge { uid: normalize_uid(&uid)? }),
        Command::Sync { app: Some(app), .. } => Input::SelectApp(app),
        Command::Sync { .. } => Input::Sync,
        Command::Tap { x, y, .. } => Input::Tap(x, y),
        Command::Restart { .. } => Input::Restart,
        Command::ForgetWifi { .. } => Input::ForgetWifi,
        Command::Unknown => return None,
    })
}

struct Downlink {
    api: Api,
    live: Live,
    inputs: Sender<Input>,
    mirror: Mirror,
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
        self.live.0.watching.store(false, Ordering::Relaxed);
        self.mirror.watched(false);
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
                if let Some(input) = input_of(command) {
                    if self.inputs.send(input).is_err() {
                        return false;
                    }
                }
                if let Some(id) = id {
                    let _ = socket.send_text(&FromTerminal::Ack { id: &id }.json(), SEND_TIMEOUT);
                }
            }
            ToTerminal::Live { watching } => {
                self.live.0.watching.store(watching, Ordering::Relaxed);
                self.mirror.watched(watching);
            }
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
        self.mirror.watched(reply.live);
        for command in reply.commands {
            log::info!("console: {command:?}");
            if let Some(input) = input_of(command) {
                if self.inputs.send(input).is_err() {
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

/// Sends each new frame while a console watches, over the relay when connected (the rows that
/// changed), else uploaded to the site; when several pile up, only the latest goes. A console
/// starting to watch gets the screen at once. Also carries the log lines a console watches.
#[derive(Clone)]
pub struct Mirror {
    up: Sender<Up>,
    live: Arc<AtomicBool>,
}

impl Mirror {
    fn start(api: Api, relay: Live) -> Result<Self> {
        let (up, received) = mpsc::channel::<Up>();
        let _ = LOGS.set((relay.clone(), Mutex::new(up.clone())));
        let live = Arc::new(AtomicBool::new(false));
        let watched = live.clone();
        thread::Builder::new()
            .stack_size(10 * 1024)
            .spawn(move || {
                let mut latest: Option<Vec<u8>> = None;
                let mut sent = true;
                let mut uploaded: Option<Vec<u8>> = None;
                let mut status_uploaded: Option<Instant> = None;
                while let Ok(message) = received.recv() {
                    for message in std::iter::once(message).chain(received.try_iter()) {
                        match message {
                            Up::Frame(frame) => {
                                if let Some(frame) = frame {
                                    latest = Some(frame);
                                }
                                sent = false;
                            }
                            Up::Log(line) => {
                                LOGS_QUEUED.fetch_sub(1, Ordering::Relaxed);
                                if let Some(socket) = relay.socket() {
                                    let _ = socket.send_text(&line, SEND_TIMEOUT);
                                }
                            }
                        }
                    }
                    let Some(frame) = latest.as_ref().filter(|_| !sent && watched.load(Ordering::Relaxed)) else {
                        continue;
                    };
                    // Uploading over HTTP lights the status bar's network arrow, which changes the
                    // screen, which uploads again: a change in the status bar alone goes at most
                    // every STATUS_EVERY; the next one elsewhere carries it.
                    let status_only = uploaded.as_ref().is_some_and(|before| before[STATUS_BYTES..] == frame[STATUS_BYTES..]);
                    if status_only && status_uploaded.is_some_and(|at| at.elapsed() < STATUS_EVERY) {
                        continue;
                    }
                    let done = relay.send_screen(frame)
                        || (!relay.connected() && api.put_frame(frame).inspect_err(|e| log::warn!("screen mirror: {e:#}")).is_ok());
                    if done {
                        sent = true;
                        uploaded = Some(frame.clone());
                        if status_only {
                            status_uploaded = Some(Instant::now());
                        }
                    }
                }
            })?;
        Ok(Self { up, live })
    }

    pub fn send(&self, frame: &[u8]) {
        let _ = self.up.send(Up::Frame(Some(frame.to_vec())));
    }

    /// Whether someone has the console open; when they just opened it, the screen goes now.
    fn watched(&self, live: bool) {
        if live && !self.live.swap(true, Ordering::Relaxed) {
            let _ = self.up.send(Up::Frame(None));
        } else if !live {
            self.live.store(false, Ordering::Relaxed);
        }
    }
}
