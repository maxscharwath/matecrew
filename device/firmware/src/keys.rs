//! The two TTP223 touch keys under the screen: D4 (GPIO 5) and D9 (GPIO 8),
//! active high. They are read by polling; a press is reported once, 120 ms
//! after it starts unless the other key joins it: both keys open the about page.

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
        loop {
            let now = started.elapsed().as_millis() as u64;
            if let Some(event) = keys.sample(left.is_high(), right.is_high(), now) {
                if inputs.send(Input::Flow(event)).is_err() {
                    return;
                }
            }
            thread::sleep(Duration::from_millis(KEY_POLL_MS));
        }
    })?;
    Ok(())
}
