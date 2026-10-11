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
use matecrew_core::{
    contract::Side,
    hardware::{TouchKeys, KEY_POLL_MS},
};
use std::{
    sync::mpsc::Sender,
    thread,
    time::{Duration, Instant},
};

use crate::{buzzer::Buzzer, Input};

/// The key that woke the terminal from deep sleep, touched before this thread ran: held still,
/// or let go already.
#[derive(Clone, Copy)]
pub enum Woken {
    /// A cold start, or the timer.
    No,
    /// Its release is a press, as if this thread had seen it go down (inside office hours: the
    /// stock was on the panel, the keys' labels with it).
    Press(Side),
    /// It only woke the terminal (its night screen was up): ignored until released.
    Ignore(Side),
}

/// Polls the keys on a thread of their own; each press beeps at once, then goes to the main loop
/// as `Input::Pressed`, even while it waits for the panel.
pub fn watch(left: Gpio5<'static>, right: Gpio8<'static>, inputs: Sender<Input>, buzzer: Buzzer, woken: Woken) -> Result<()> {
    // Pulled down so a key that is not wired yet reads as released.
    let left = PinDriver::input(left, Pull::Down)?;
    let right = PinDriver::input(right, Pull::Down)?;
    // Pins and the piezo, never the flash: its stack fits in PSRAM.
    crate::cores::stacks_in_psram(|| thread::Builder::new().stack_size(3072).spawn(move || {
        let mut keys = TouchKeys::default();
        let started = Instant::now();
        let (mut last, mut level) = ([false; 2], [false; 2]);
        let mut rose = [0u64; 2];
        // A key ignored until it reads released.
        let mut ignored = [false; 2];
        // The press that woke it: the boot melody already says so.
        let mut silent = matches!(woken, Woken::Press(_));
        match woken {
            Woken::No => {}
            Woken::Press(side) => {
                let side = side as usize;
                (last[side], level[side]) = (true, true);
                let _ = keys.sample(side == 0, side == 1, 0);
            }
            Woken::Ignore(side) => ignored[side as usize] = true,
        }
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
            for side in 0..2 {
                ignored[side] &= level[side] || read[side];
            }
            if let Some(event) = keys.sample(level[0] && !ignored[0], level[1] && !ignored[1], now) {
                log::info!("keys: {event:?}");
                if !std::mem::take(&mut silent) {
                    buzzer.beep(matecrew_core::flow::Beep::Key);
                }
                if inputs.send(Input::Pressed(event)).is_err() {
                    return;
                }
            }
            thread::sleep(Duration::from_millis(KEY_POLL_MS));
        }
    }))?;
    Ok(())
}
