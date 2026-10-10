//! Commands typed in the serial monitor stand in for the keys and the NFC
//! reader: `l`, `r`, `b <uid>`, `s`. See `matecrew_core::console`.

use anyhow::Result;
use esp_idf_svc::sys::{
    esp, esp_vfs_usb_serial_jtag_use_driver, usb_serial_jtag_driver_config_t,
    usb_serial_jtag_driver_install,
};
use matecrew_core::{
    console::{self, Command},
    flow::Event,
};
use std::{
    io::{self, Read},
    sync::mpsc::Sender,
    thread,
};

use crate::Input;

pub fn watch(inputs: Sender<Input>) -> Result<()> {
    // Without the driver, reading the USB serial console never blocks and loses input.
    let mut config = usb_serial_jtag_driver_config_t {
        tx_buffer_size: 256,
        rx_buffer_size: 256,
    };
    esp!(unsafe { usb_serial_jtag_driver_install(&mut config) })?;
    unsafe { esp_vfs_usb_serial_jtag_use_driver() };

    thread::Builder::new().stack_size(4096).spawn(move || {
        log::info!("console: {}", console::HELP);
        let mut line = Vec::new();
        for byte in io::stdin().lock().bytes() {
            let Ok(byte) = byte else { continue };
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
    })?;
    Ok(())
}
