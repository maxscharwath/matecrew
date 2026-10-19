//! Commands typed in the serial monitor (`just flash`). They stand in for the
//! touch keys and the NFC reader, so the whole take flow can be tried on a
//! board with nothing wired to it.

use crate::contract::{normalize_uid, Side};

#[derive(Debug, PartialEq)]
pub enum Command {
    Key(Side),
    Badge(String),
    Sync,
    App(crate::contract::BuiltinApp),
    Tap(i32, i32),
    Notify(String),
    /// Both keys together: the about page.
    BothKeys,
    /// The same site at a new address (a dev Mac whose IP changed); the token stays.
    Site(String),
    /// Deep sleep now, as after two idle minutes, even with the USB cable in; with a number, the
    /// timer wakes it after that many seconds at the latest. To try sleep and wake at the desk.
    Sleep(Option<u32>),
    /// `wifi`: the networks kept, in the log.
    Networks,
    /// `wifi setup`: the setup access point, to add a network; the others stay.
    WifiSetup,
    /// `wifi forget <ssid>`: forgets one network (its name may hold spaces).
    WifiForget(String),
    Help,
}

pub const HELP: &str = "l: touche gauche, r: touche droite, both: les deux (a propos), b <uid>: badge, s: synchro, app mate|showcase, tap <x> <y>, notify <message>, site <url>, sleep [s]: veille (reveil apres s secondes), wifi: reseaux gardes, wifi setup: ajouter un reseau, wifi forget <ssid>";

pub fn parse(line: &str) -> Option<Command> {
    if let Some(message) = line.trim().strip_prefix("notify ") {
        let message = message.trim();
        return (!message.is_empty() && message.len() <= 256)
            .then(|| Command::Notify(message.into()));
    }
    if let Some(ssid) = line.trim().strip_prefix("wifi forget ") {
        let ssid = ssid.trim();
        return (!ssid.is_empty() && ssid.len() <= 32).then(|| Command::WifiForget(ssid.into()));
    }
    let mut words = line.split_whitespace();
    let command = match words.next()?.to_ascii_lowercase().as_str() {
        "l" | "left" => Command::Key(Side::Left),
        "r" | "right" => Command::Key(Side::Right),
        "b" | "badge" => Command::Badge(normalize_uid(words.next()?)?),
        "s" | "sync" => Command::Sync,
        "both" | "lr" => Command::BothKeys,
        "sleep" => match words.next() {
            None => Command::Sleep(None),
            Some(seconds) => Command::Sleep(Some(seconds.parse::<u32>().ok().filter(|s| (1..=86_400).contains(s))?)),
        },
        "site" => {
            let url = words.next()?.trim_end_matches('/');
            let scheme = url.starts_with("http://") || url.starts_with("https://");
            if !scheme || url.len() > 128 || words.next().is_some() {
                return None;
            }
            Command::Site(url.to_owned())
        }
        "app" => Command::App(match words.next()? {
            "mate" => crate::contract::BuiltinApp::Mate,
            "showcase" => crate::contract::BuiltinApp::Showcase,
            _ => return None,
        }),
        "tap" => {
            let x = words.next()?.parse::<i32>().ok()?;
            let y = words.next()?.parse::<i32>().ok()?;
            if !(0..200).contains(&x) || !(0..120).contains(&y) {
                return None;
            }
            Command::Tap(x, y)
        }
        "wifi" => match words.next() {
            None => Command::Networks,
            Some("setup") => Command::WifiSetup,
            Some(_) => return None,
        },
        "h" | "help" | "?" => Command::Help,
        _ => return None,
    };
    Some(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_commands() {
        assert_eq!(parse("l"), Some(Command::Key(Side::Left)));
        assert_eq!(parse(" RIGHT \r"), Some(Command::Key(Side::Right)));
        assert_eq!(
            parse("b 04:a1:b2:c3"),
            Some(Command::Badge("04A1B2C3".into()))
        );
        assert_eq!(parse("s"), Some(Command::Sync));
    }

    #[test]
    fn reads_both_keys_and_a_new_site_address() {
        assert_eq!(parse("both"), Some(Command::BothKeys));
        assert_eq!(parse("site http://192.168.1.110:3000/"), Some(Command::Site("http://192.168.1.110:3000".into())));
        assert_eq!(parse("site ftp://x"), None);
        assert_eq!(parse("site"), None);
    }

    #[test]
    fn reads_a_sleep_with_its_timer() {
        assert_eq!(parse("sleep"), Some(Command::Sleep(None)));
        assert_eq!(parse("sleep 60"), Some(Command::Sleep(Some(60))));
        assert_eq!(parse("sleep 0"), None);
        assert_eq!(parse("sleep soon"), None);
    }

    #[test]
    fn reads_the_wifi_commands() {
        assert_eq!(parse("wifi"), Some(Command::Networks));
        assert_eq!(parse("wifi setup"), Some(Command::WifiSetup));
        assert_eq!(parse("wifi forget OWT Guest \r"), Some(Command::WifiForget("OWT Guest".into())));
        assert_eq!(parse("wifi forget "), None);
        assert_eq!(parse("wifi reset"), None);
    }

    #[test]
    fn ignores_the_rest() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("b"), None);
        assert_eq!(parse("b 12"), None);
        assert_eq!(parse("reboot"), None);
    }
}
