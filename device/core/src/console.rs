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
    Help,
}

pub const HELP: &str = "l: touche gauche, r: touche droite, both: les deux (a propos), b <uid>: badge, s: synchro, app mate|showcase, tap <x> <y>, notify <message>, site <url>";

pub fn parse(line: &str) -> Option<Command> {
    if let Some(message) = line.trim().strip_prefix("notify ") {
        let message = message.trim();
        return (!message.is_empty() && message.len() <= 256)
            .then(|| Command::Notify(message.into()));
    }
    let mut words = line.split_whitespace();
    let command = match words.next()?.to_ascii_lowercase().as_str() {
        "l" | "left" => Command::Key(Side::Left),
        "r" | "right" => Command::Key(Side::Right),
        "b" | "badge" => Command::Badge(normalize_uid(words.next()?)?),
        "s" | "sync" => Command::Sync,
        "both" | "lr" => Command::BothKeys,
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
    fn ignores_the_rest() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("b"), None);
        assert_eq!(parse("b 12"), None);
        assert_eq!(parse("reboot"), None);
    }
}
