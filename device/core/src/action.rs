//! What a console asks the terminal to do, whichever way it comes: Bluetooth (`link::Control`),
//! the relay or the site's long poll (`contract::Command`). One vocabulary, so the firmware turns
//! it into an input in one place.

use crate::contract::{normalize_uid, BuiltinApp, Command, Side};
use crate::link::Control;

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Key(Side),
    /// A key held: the long press the terminal's own key makes.
    LongKey(Side),
    /// Both keys together: the about page.
    Both,
    /// A normalized UID.
    Badge(String),
    Sync,
    /// Sync, then run this built-in app.
    App(BuiltinApp),
    /// A point of the remote's 200 × 120 grid.
    Tap { x: i32, y: i32 },
    Restart,
    ForgetWifi,
    /// Deep sleep now, whatever keeps the terminal awake otherwise.
    Sleep,
    /// A toast on the panel.
    Notify(String),
}

/// The remote's tap grid, whatever the panel's size.
pub const TAP_WIDTH: i32 = 200;
pub const TAP_HEIGHT: i32 = 120;

fn tap(x: i32, y: i32) -> Option<Action> {
    ((0..TAP_WIDTH).contains(&x) && (0..TAP_HEIGHT).contains(&y)).then_some(Action::Tap { x, y })
}

impl Action {
    /// From the relay or the long poll; `None` for a badge that is not a UID, a tap off the grid
    /// or a kind this firmware does not know.
    pub fn from_command(command: Command) -> Option<Self> {
        Some(match command {
            Command::Key { side, .. } => Self::Key(side),
            Command::LongKey { side, .. } => Self::LongKey(side),
            Command::Both { .. } => Self::Both,
            Command::Badge { uid, .. } => Self::Badge(normalize_uid(&uid)?),
            Command::Sync { app: Some(app), .. } => Self::App(app),
            Command::Sync { .. } => Self::Sync,
            Command::Tap { x, y, .. } => return tap(x, y),
            Command::Restart { .. } => Self::Restart,
            Command::ForgetWifi { .. } => Self::ForgetWifi,
            Command::Sleep { .. } => Self::Sleep,
            Command::Unknown => return None,
        })
    }

    /// From a browser over Bluetooth; `None` for a badge that is not a UID or a tap off the grid.
    pub fn from_control(control: Control) -> Option<Self> {
        Some(match control {
            Control::Key { side } => Self::Key(side),
            Control::LongKey { side } => Self::LongKey(side),
            Control::Both => Self::Both,
            Control::Badge { uid } => Self::Badge(normalize_uid(&uid)?),
            Control::Sync => Self::Sync,
            Control::Tap { x, y } => return tap(x, y),
            Control::Restart => Self::Restart,
            Control::Sleep => Self::Sleep,
            Control::Notify { text } => Self::Notify(text),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bluetooth_and_the_relay_ask_for_the_same_things() {
        let relayed: Command =
            serde_json::from_str(r#"{"id":"c1","kind":"tap","x":10,"y":20}"#).unwrap();
        let nearby = Control::parse(br#"{"cmd":"tap","x":10,"y":20}"#).unwrap();
        assert_eq!(Action::from_command(relayed), Action::from_control(nearby));
        assert_eq!(
            Action::from_control(Control::Badge { uid: "04:a1:b2:c3".into() }),
            Some(Action::Badge("04A1B2C3".into()))
        );
        assert_eq!(Action::from_control(Control::Badge { uid: "nope".into() }), None);
        assert_eq!(Action::from_control(Control::Tap { x: 200, y: 0 }), None);
        let app: Command = serde_json::from_str(r#"{"id":"c2","kind":"sync","app":"showcase"}"#).unwrap();
        assert_eq!(Action::from_command(app), Some(Action::App(BuiltinApp::Showcase)));
        assert_eq!(Action::from_command(Command::Unknown), None);
        let held: Command = serde_json::from_str(r#"{"id":"c3","kind":"longKey","side":"right"}"#).unwrap();
        assert_eq!(Action::from_command(held), Some(Action::LongKey(Side::Right)));
        let nearby = Control::parse(br#"{"cmd":"longKey","side":"left"}"#).unwrap();
        assert_eq!(Action::from_control(nearby), Some(Action::LongKey(Side::Left)));
        let relayed: Command = serde_json::from_str(r#"{"id":"c4","kind":"sleep"}"#).unwrap();
        let nearby = Control::parse(br#"{"cmd":"sleep"}"#).unwrap();
        assert_eq!(Action::from_command(relayed), Some(Action::Sleep));
        assert_eq!(Action::from_control(nearby), Some(Action::Sleep));
    }
}
