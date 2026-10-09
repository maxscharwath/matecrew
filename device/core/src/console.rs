//! Commands typed in the serial monitor (`just flash`). They stand in for the
//! touch keys and the NFC reader, so the whole take flow can be tried on a
//! board with nothing wired to it.

use crate::contract::{normalize_uid, Side};

#[derive(Debug, PartialEq)]
pub enum Command {
    Key(Side),
    Badge(String),
    Sync,
    Help,
}

pub const HELP: &str = "l: touche gauche, r: touche droite, b <uid>: badge, s: synchro";

pub fn parse(line: &str) -> Option<Command> {
    let mut words = line.split_whitespace();
    let command = match words.next()?.to_ascii_lowercase().as_str() {
        "l" | "left" => Command::Key(Side::Left),
        "r" | "right" => Command::Key(Side::Right),
        "b" | "badge" => Command::Badge(normalize_uid(words.next()?)?),
        "s" | "sync" => Command::Sync,
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
        assert_eq!(parse("b 04:a1:b2:c3"), Some(Command::Badge("04A1B2C3".into())));
        assert_eq!(parse("s"), Some(Command::Sync));
    }

    #[test]
    fn ignores_the_rest() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("b"), None);
        assert_eq!(parse("b 12"), None);
        assert_eq!(parse("reboot"), None);
    }
}
