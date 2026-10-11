//! Deep sleep between uses. The e-ink panel keeps its image without power: the terminal shows
//! what it should while asleep (the stock with the moon in its status bar inside office hours, its
//! night screen outside them), then cuts everything but the RTC. A touch key wakes it (ext1 on
//! GPIO 5 and 8, both RTC pins), and its timer does to sync now and then.
//!
//! What it needs right after waking stays in RTC memory, kept through deep sleep and cleared on a
//! cold boot (`KEPT`): what the panel shows, to draw it again and start from it with a partial
//! refresh instead of a flash, and the access point, to join it without scanning.

use core::ptr::addr_of_mut;
use esp_idf_svc::sys::{
    esp_deep_sleep_start, esp_sleep_enable_ext1_wakeup_io, esp_sleep_enable_timer_wakeup,
    esp_sleep_ext1_wakeup_mode_t_ESP_EXT1_WAKEUP_ANY_HIGH, esp_sleep_get_ext1_wakeup_status,
    esp_sleep_get_wakeup_cause, esp_sleep_source_t_ESP_SLEEP_WAKEUP_EXT1, esp_sleep_source_t_ESP_SLEEP_WAKEUP_TIMER,
};
use matecrew_core::contract::Side;
use std::time::Duration;

use crate::display::Wear;

/// The touch keys: D4 and D9.
const LEFT_KEY: u32 = 5;
const RIGHT_KEY: u32 = 8;
/// `$device` as the screen was drawn with it: about 700 bytes.
const DEVICE_MAX: usize = 2048;
const DAY_MAX: usize = 32;
const TIME_MAX: usize = 8;
/// Written with what is kept: anything else in RTC memory is a cold boot's.
const MAGIC: u32 = 0x5EE9_0002;

/// Why the terminal started.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Wake {
    /// Power on, a restart, a crash, a flash: nothing is kept.
    Cold,
    /// Its timer: sync, then sleep again unless something happens.
    Timer,
    /// A touch key.
    Key(Side),
}

/// What the panel showed when the terminal went to sleep.
#[derive(Debug, Clone, PartialEq)]
pub struct Shown {
    /// `$device` (JSON) the screen was drawn with.
    pub device: String,
    /// The office was closed: its night screen. Open: the main screen.
    pub night: Option<Night>,
    /// `digest` of the frame: the screen drawn again must be the same.
    pub digest: u32,
    /// How worn the panel's image is.
    pub wear: Wear,
}

/// The night screen's words: `ui::sleep_screen`.
#[derive(Debug, Clone, PartialEq)]
pub struct Night {
    pub weekend: bool,
    pub day: String,
    pub time: String,
}

#[repr(C)]
struct Kept {
    magic: u32,
    /// 1: the main screen, 2: the night screen, 0: nothing to draw again.
    shown: u8,
    weekend: u8,
    /// The access point last joined, 0 for none.
    channel: u8,
    bssid: [u8; 6],
    digest: u32,
    partials: u32,
    ghost: u32,
    age: u32,
    device_len: u16,
    device: [u8; DEVICE_MAX],
    day_len: u8,
    day: [u8; DAY_MAX],
    time_len: u8,
    time: [u8; TIME_MAX],
}

const EMPTY: Kept = Kept {
    magic: MAGIC,
    shown: 0,
    weekend: 0,
    channel: 0,
    bssid: [0; 6],
    digest: 0,
    partials: 0,
    ghost: 0,
    age: 0,
    device_len: 0,
    device: [0; DEVICE_MAX],
    day_len: 0,
    day: [0; DAY_MAX],
    time_len: 0,
    time: [0; TIME_MAX],
};

#[link_section = ".rtc.data"]
static mut KEPT: Kept = Kept { magic: 0, ..EMPTY };

/// The RTC memory kept through deep sleep.
fn kept() -> &'static mut Kept {
    // SAFETY: only the main task calls this module, at start and before sleeping.
    unsafe { &mut *addr_of_mut!(KEPT) }
}

/// Why it started. Call once, first: anything but a wake from deep sleep clears what was kept.
pub fn woke() -> Wake {
    // SAFETY: plain ESP-IDF queries.
    let (cause, keys) = unsafe { (esp_sleep_get_wakeup_cause(), esp_sleep_get_ext1_wakeup_status()) };
    let wake = match cause {
        c if c == esp_sleep_source_t_ESP_SLEEP_WAKEUP_TIMER => Wake::Timer,
        c if c == esp_sleep_source_t_ESP_SLEEP_WAKEUP_EXT1 && keys & (1 << RIGHT_KEY) != 0 => Wake::Key(Side::Right),
        c if c == esp_sleep_source_t_ESP_SLEEP_WAKEUP_EXT1 => Wake::Key(Side::Left),
        _ => Wake::Cold,
    };
    if wake == Wake::Cold || kept().magic != MAGIC {
        *kept() = EMPTY;
        return Wake::Cold;
    }
    wake
}

/// What the panel showed when it went to sleep; `None` after a cold boot.
pub fn shown() -> Option<Shown> {
    let kept = kept();
    let text = |bytes: &[u8], len: usize| String::from_utf8_lossy(&bytes[..len.min(bytes.len())]).into_owned();
    let device = text(&kept.device, kept.device_len.into());
    let night = Night {
        weekend: kept.weekend != 0,
        day: text(&kept.day, kept.day_len.into()),
        time: text(&kept.time, kept.time_len.into()),
    };
    let wear = Wear { partials: kept.partials, ghost: kept.ghost, age: kept.age };
    match kept.shown {
        1 => Some(Shown { device, night: None, digest: kept.digest, wear }),
        2 => Some(Shown { device, night: Some(night), digest: kept.digest, wear }),
        _ => None,
    }
}

/// The access point to join without scanning: (channel, BSSID).
pub fn access_point() -> Option<(u8, [u8; 6])> {
    let kept = kept();
    (kept.channel != 0).then_some((kept.channel, kept.bssid))
}

/// Remembers the access point joined, for the next wake; `None` forgets it.
pub fn keep_access_point(joined: Option<(u8, [u8; 6])>) {
    let kept = kept();
    (kept.channel, kept.bssid) = joined.unwrap_or_default();
}

/// FNV-1a of a frame: whether the screen drawn again after a wake is the one the panel shows.
pub fn digest(bits: &[u8]) -> u32 {
    bits.iter().fold(0x811C_9DC5, |hash, &byte| (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193))
}

/// Copies `text` into `into`, or nothing if it does not fit: its length.
fn put<const N: usize>(into: &mut [u8; N], text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    into.get_mut(..bytes.len())?.copy_from_slice(bytes);
    Some(bytes.len())
}

/// Sleeps until a touch key, or `wake_in`; what the panel shows is kept for the next start.
pub fn sleep(shown: Shown, wake_in: Option<Duration>) -> ! {
    let kept = kept();
    let night = shown.night.as_ref();
    let fits = (|| {
        kept.device_len = put(&mut kept.device, &shown.device)? as u16;
        kept.day_len = put(&mut kept.day, night.map_or("", |n| &n.day))? as u8;
        kept.time_len = put(&mut kept.time, night.map_or("", |n| &n.time))? as u8;
        Some(())
    })();
    kept.weekend = u8::from(night.is_some_and(|n| n.weekend));
    kept.digest = shown.digest;
    (kept.partials, kept.ghost, kept.age) = (shown.wear.partials, shown.wear.ghost, shown.wear.age);
    kept.shown = match (fits, night) {
        (None, _) => {
            log::warn!("sleep: {} bytes of status not kept, the first screen will flash", shown.device.len());
            0
        }
        (Some(()), None) => 1,
        (Some(()), Some(_)) => 2,
    };
    log::info!(
        "sleep: {} screen, waking up {}",
        if night.is_some() { "night" } else { "main" },
        wake_in.map_or("on a key".to_owned(), |d| format!("in {} s or on a key", d.as_secs()))
    );
    // SAFETY: plain ESP-IDF calls; the pins are the keys' RTC GPIOs. No pull-down: the TTP223
    // drive their output both ways, and one would keep the RTC peripherals powered.
    unsafe {
        esp_sleep_enable_ext1_wakeup_io(
            (1u64 << LEFT_KEY) | (1u64 << RIGHT_KEY),
            esp_sleep_ext1_wakeup_mode_t_ESP_EXT1_WAKEUP_ANY_HIGH,
        );
        if let Some(wake_in) = wake_in {
            esp_sleep_enable_timer_wakeup(u64::try_from(wake_in.as_micros()).unwrap_or(u64::MAX));
        }
        esp_deep_sleep_start()
    }
}
