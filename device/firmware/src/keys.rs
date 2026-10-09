//! The two TTP223 touch keys under the screen: D4 (GPIO 5) and D9 (GPIO 8),
//! active high. They are read by polling; a press is reported once, when it
//! starts.

use anyhow::Result;
use esp_idf_svc::hal::gpio::{Gpio5, Gpio8, PinDriver, Pull};
use matecrew_core::contract::Side;
use std::{sync::mpsc::Sender, thread, time::Duration};

use crate::Event;

pub fn watch(left: Gpio5<'static>, right: Gpio8<'static>, events: Sender<Event>) -> Result<()> {
    // Pulled down so a key that is not wired yet reads as released.
    let left = PinDriver::input(left, Pull::Down)?;
    let right = PinDriver::input(right, Pull::Down)?;
    thread::Builder::new().stack_size(3072).spawn(move || {
        let mut was = (false, false);
        loop {
            let now = (left.is_high(), right.is_high());
            for (pressed, before, side) in [(now.0, was.0, Side::Left), (now.1, was.1, Side::Right)] {
                if pressed && !before && events.send(Event::Key(side)).is_err() {
                    return;
                }
            }
            was = now;
            thread::sleep(Duration::from_millis(20));
        }
    })?;
    Ok(())
}
