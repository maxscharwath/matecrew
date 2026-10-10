//! Network activity for the status bar: every exchange with the outside world shows an arrow
//! for a few seconds, up for what the terminal sends, down for what it receives (`$device.net`):
//! the site's API, the console's wait (a blink when it is sent and when it answers, not while it
//! waits), the screen mirror, the clock (NTP) and Bluetooth.
//!
//! Transfers run on several threads; the screen loop hears of a change through `Input::Net`
//! and redraws, and `hide_at` tells it when the arrows go out.

use std::{
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc::Sender,
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

use crate::Input;

/// How long an arrow stays after its transfer.
const LINGER: Duration = Duration::from_secs(3);

static EPOCH: OnceLock<Instant> = OnceLock::new();
static WAKE: OnceLock<Mutex<Sender<Input>>> = OnceLock::new();

/// One direction: transfers under way, and when the last one ended (tenths of a second since
/// `EPOCH`, 0 never: the ESP32-S3 has no 64-bit atomics, and 32 bits of tenths last 13 years).
struct Direction {
    active: AtomicU32,
    ended: AtomicU32,
}

/// When the arrows last lit up (tenths of a second since `EPOCH`), for the log.
static LIT: AtomicU32 = AtomicU32::new(0);

static UP: Direction = Direction { active: AtomicU32::new(0), ended: AtomicU32::new(0) };
static DOWN: Direction = Direction { active: AtomicU32::new(0), ended: AtomicU32::new(0) };

/// `LINGER` in tenths of a second.
const LINGER_TENTHS: u32 = (LINGER.as_millis() / 100) as u32;

fn now() -> u32 {
    (EPOCH.get_or_init(Instant::now).elapsed().as_millis() / 100) as u32 + 1
}

/// Lets transfers tell the screen loop.
pub fn watch(inputs: Sender<Input>) {
    EPOCH.get_or_init(Instant::now);
    let _ = WAKE.set(Mutex::new(inputs));
}

fn wake() {
    if let Some(inputs) = WAKE.get() {
        let _ = inputs.lock().map(|inputs| inputs.send(Input::Net));
    }
}

impl Direction {
    fn lit(&self, now: u32) -> bool {
        let ended = self.ended.load(Ordering::Relaxed);
        self.active.load(Ordering::Relaxed) > 0 || (ended > 0 && now < ended + LINGER_TENTHS)
    }
}

/// A transfer under way: the arrow shows until a while after it is dropped.
pub struct Transfer(&'static Direction);

/// Starts a transfer: `up` for what the terminal sends.
pub fn transfer(up: bool) -> Transfer {
    let direction = if up { &UP } else { &DOWN };
    let was = direction.lit(now());
    direction.active.fetch_add(1, Ordering::Relaxed);
    if !was {
        LIT.store(now(), Ordering::Relaxed);
        wake();
    }
    Transfer(direction)
}

impl Drop for Transfer {
    fn drop(&mut self) {
        self.0.ended.store(now(), Ordering::Relaxed);
        self.0.active.fetch_sub(1, Ordering::Relaxed);
        // The loop learns when the arrow goes out.
        wake();
    }
}

/// An exchange too short or too long to follow: the arrow blinks for `LINGER`.
pub fn pulse(up: bool) {
    drop(transfer(up));
}

/// How long ago an arrow last lit up: how late the screen shows it.
pub fn lit_ago() -> Duration {
    Duration::from_millis(u64::from(now().saturating_sub(LIT.load(Ordering::Relaxed))) * 100)
}

/// The arrows lit now: (up, down).
pub fn shown() -> (bool, bool) {
    let now = now();
    (UP.lit(now), DOWN.lit(now))
}

/// When the lit arrows go out if nothing else happens; None when none is lit or a transfer is
/// under way (its end tells the loop again).
pub fn hide_at() -> Option<Instant> {
    let epoch = *EPOCH.get()?;
    let now = now();
    let mut latest = None;
    for direction in [&UP, &DOWN] {
        if direction.active.load(Ordering::Relaxed) > 0 {
            return None;
        }
        let ended = direction.ended.load(Ordering::Relaxed);
        if ended > 0 && now < ended + LINGER_TENTHS {
            let at = epoch + Duration::from_millis(u64::from(ended) * 100) + LINGER;
            latest = latest.max(Some(at));
        }
    }
    latest
}
