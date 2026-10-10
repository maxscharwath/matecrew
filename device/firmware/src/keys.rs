//! The two TTP223 touch keys under the screen: D4 (GPIO 5) and D9 (GPIO 8),
//! active high. They are read by polling; a press is reported once, when it
//! starts.

use anyhow::Result;
use esp_idf_svc::hal::gpio::{Gpio5, Gpio8, PinDriver, Pull};
use matecrew_core::{
    flow::Event,
    hardware::{TouchKeys, KEY_POLL_MS},
};
use std::{sync::mpsc::Sender, thread, time::Duration};

use crate::Input;

pub fn watch(left: Gpio5<'static>, right: Gpio8<'static>, inputs: Sender<Input>) -> Result<()> {
    // Pulled down so a key that is not wired yet reads as released.
    let left = PinDriver::input(left, Pull::Down)?;
    let right = PinDriver::input(right, Pull::Down)?;
    thread::Builder::new().stack_size(3072).spawn(move || {
        let mut keys = TouchKeys::default();
        loop {
            for side in keys
                .sample(left.is_high(), right.is_high())
                .into_iter()
                .flatten()
            {
                if inputs.send(Input::Flow(Event::Key { side })).is_err() {
                    return;
                }
            }
            thread::sleep(Duration::from_millis(KEY_POLL_MS));
        }
    })?;
    Ok(())
}
