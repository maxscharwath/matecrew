//! Whoever watches the terminal from afar: a browser paired over Bluetooth (`ble`) and the site's
//! consoles over the relay (`remote`). The terminal says a thing once, here; every transport that
//! is open passes it on, in the same JSON (`link::Event`), as far as it may: Bluetooth to its
//! paired browser, the relay its log while a console watches and its beeps whenever connected.
//! What comes back the other way goes through one vocabulary too (`matecrew_core::action`).

use matecrew_core::link::Event;

/// A log line or a beep, to every open transport. Never blocks.
pub fn publish(event: Event) {
    crate::remote::publish(&event);
    crate::ble::send(event);
}

/// A new screen on the panel, to every open transport. Never blocks for long: a copy each.
pub fn screen(bits: &[u8]) {
    crate::remote::screen(bits);
    crate::ble::show_screen(bits);
}
