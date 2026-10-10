//! The two TTP223 touch keys under the screen: D4 (GPIO 5) and D9 (GPIO 8),
//! active high. They are read by polling; a press is reported once, 120 ms
//! after it starts unless the other key joins it: both keys open the about page.
//!
//! A level counts once two samples in a row agree: a long wire to a key can
//! pick up noise for an instant, and a key read high once would turn the page
//! by itself. A finger stays far longer. Each high level's length is logged,
//! to tell noise from a key that triggers by itself.

use anyhow::Result;
use esp_idf_svc::hal::gpio::{Gpio5, Gpio8, PinDriver, Pull};
use matecrew_core::hardware::{TouchKeys, KEY_POLL_MS};
use std::{
    sync::mpsc::Sender,
    thread,
    time::{Duration, Instant},
};

use crate::Input;

pub fn watch(left: Gpio5<'static>, right: Gpio8<'static>, inputs: Sender<Input>) -> Result<()> {
    // Pulled down so a key that is not wired yet reads as released.
    let left = PinDriver::input(left, Pull::Down)?;
    let right = PinDriver::input(right, Pull::Down)?;
    thread::Builder::new().stack_size(3072).spawn(move || {
        let mut keys = TouchKeys::default();
        let started = Instant::now();
        let (mut last, mut level) = ([false; 2], [false; 2]);
        let mut rose = [0u64; 2];
        loop {
            let now = started.elapsed().as_millis() as u64;
            let read = [left.is_high(), right.is_high()];
            for (side, name) in ["left", "right"].iter().enumerate() {
                if read[side] && !last[side] {
                    rose[side] = now;
                } else if !read[side] && last[side] {
                    log::info!("keys: {name} high for {} ms", now - rose[side]);
                }
                if read[side] == last[side] {
                    level[side] = read[side];
                }
            }
            last = read;
            if let Some(event) = keys.sample(level[0], level[1], now) {
                log::info!("keys: {event:?}");
                if inputs.send(Input::Flow(event)).is_err() {
                    return;
                }
            }
            thread::sleep(Duration::from_millis(KEY_POLL_MS));
        }
    })?;
    Ok(())
}
