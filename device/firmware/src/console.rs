//! Commands typed in the serial monitor stand in for the keys and the NFC
//! reader: `l`, `r`, `b <uid>`, `s`. See `matecrew_core::console`.

use anyhow::Result;
use esp_idf_svc::{
    hal::delay::BLOCK,
    sys::{
        esp, esp_vfs_usb_serial_jtag_use_driver, usb_serial_jtag_driver_config_t,
        usb_serial_jtag_driver_install, usb_serial_jtag_read_bytes,
    },
};
use matecrew_core::{
    console::{self, Command},
    flow::Event,
};
use std::{sync::mpsc::Sender, thread};

use crate::Input;

pub fn watch(inputs: Sender<Input>) -> Result<()> {
    // Without the driver, reading the USB serial console never blocks and loses input.
    let mut config = usb_serial_jtag_driver_config_t {
        tx_buffer_size: 256,
        rx_buffer_size: 256,
    };
    esp!(unsafe { usb_serial_jtag_driver_install(&mut config) })?;
    unsafe { esp_vfs_usb_serial_jtag_use_driver() };

    // It reads the USB port and hands commands on, never the flash: its stack fits in PSRAM.
    crate::cores::stacks_in_psram(|| thread::Builder::new().stack_size(4096).spawn(move || {
        log::info!("console: {}", console::HELP);
        let mut line = Vec::new();
        for byte in bytes() {
            if byte != b'\r' && byte != b'\n' {
                line.push(byte);
                continue;
            }
            let text = String::from_utf8_lossy(&line).into_owned();
            line.clear();
            let input = match console::parse(&text) {
                Some(Command::Key(side)) => Input::Flow(Event::Key { side }),
                Some(Command::Badge(uid)) => Input::Flow(Event::Badge { uid }),
                Some(Command::Sync) => Input::Sync,
                Some(Command::App(app)) => Input::SelectApp(app),
                Some(Command::Tap(x, y)) => Input::Tap(x, y),
                Some(Command::Notify(message)) => Input::Notify(message),
                Some(Command::BothKeys) => Input::Flow(Event::BothKeys),
                Some(Command::Site(url)) => Input::MoveSite(url),
                Some(Command::Sleep(seconds)) => Input::Doze(seconds.map(|s| std::time::Duration::from_secs(s.into()))),
                Some(Command::Networks) => Input::Networks,
                Some(Command::WifiSetup) => Input::WifiSetup,
                Some(Command::WifiForget(ssid)) => Input::ForgetNetwork(ssid),
                Some(Command::Help) => {
                    log::info!("console: {}", console::HELP);
                    continue;
                }
                None if text.trim().is_empty() => continue,
                None => {
                    log::warn!("console: {text:?} ? {}", console::HELP);
                    continue;
                }
            };
            if inputs.send(input).is_err() {
                return;
            }
        }
    }))?;
    Ok(())
}

/// The console's bytes, out of the driver's buffer. Without a USB host (on a wall charger)
/// stdin fails at once, every time: read in a loop, it took a whole core and the boot stopped
/// at its first screen. The driver's read waits for bytes instead.
fn bytes() -> impl Iterator<Item = u8> {
    let mut buf = [0u8; 64];
    let (mut at, mut len) = (0, 0);
    std::iter::from_fn(move || {
        while at == len {
            // SAFETY: `watch` installed the driver, and `buf` outlives the call.
            let read = unsafe { usb_serial_jtag_read_bytes(buf.as_mut_ptr().cast(), buf.len() as u32, BLOCK) };
            (at, len) = (0, read.max(0) as usize);
        }
        at += 1;
        Some(buf[at - 1])
    })
}
