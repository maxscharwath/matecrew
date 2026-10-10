//! Board support for the XIAO ESP32-S3 terminal: its pin map, the TTP223 touch keys' edge
//! detector and the piezo's tone programs. The firmware, the site's virtual device and the
//! SDK emulator all use this crate, so the three behave like the same hardware.
use serde::{Deserialize, Serialize};

pub const KEY_LEFT_GPIO: u8 = 5;
pub const KEY_RIGHT_GPIO: u8 = 8;
/// D5: the piezo shares it with the battery reading (a piezo passes no direct current).
pub const BUZZER_GPIO: u8 = 6;
/// The firmware samples both keys at this period; so do the emulators.
pub const KEY_POLL_MS: u64 = 20;
/// After one key, the other within this window makes both keys (the terminal's about page)
/// rather than its own press. A lone key is reported once the window has passed.
pub const CHORD_MS: u64 = 120;
/// The e-paper panel driven over SPI.
pub const PANEL: [u32; 2] = [800, 480];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Signal {
    Panel,
    Key,
    Buzzer,
    I2c,
    Adc,
    Free,
}

/// One wired pad, as soldered on the terminal (see device/CLAUDE.md).
#[derive(Clone, Copy, Debug, Serialize)]
pub struct Pin {
    pub pad: &'static str,
    pub gpio: u8,
    pub function: &'static str,
    pub signal: Signal,
}

pub const PINS: &[Pin] = &[
    Pin { pad: "D0", gpio: 1, function: "Écran RST", signal: Signal::Panel },
    Pin { pad: "D1", gpio: 2, function: "Écran CS", signal: Signal::Panel },
    Pin { pad: "D2", gpio: 3, function: "Écran BUSY", signal: Signal::Panel },
    Pin { pad: "D3", gpio: 4, function: "Écran DC", signal: Signal::Panel },
    Pin { pad: "D4", gpio: KEY_LEFT_GPIO, function: "Touche gauche (TTP223)", signal: Signal::Key },
    Pin { pad: "D5", gpio: BUZZER_GPIO, function: "Buzzer piézo (LEDC) et batterie (pont 1 MΩ / 1 MΩ)", signal: Signal::Buzzer },
    Pin { pad: "D6", gpio: 43, function: "PN532 SDA (I2C 0x24)", signal: Signal::I2c },
    Pin { pad: "D7", gpio: 44, function: "PN532 SCL", signal: Signal::I2c },
    Pin { pad: "D8", gpio: 7, function: "Écran SCK", signal: Signal::Panel },
    Pin { pad: "D9", gpio: KEY_RIGHT_GPIO, function: "Touche droite (TTP223)", signal: Signal::Key },
    Pin { pad: "D10", gpio: 9, function: "Écran MOSI", signal: Signal::Panel },
];

/// TTP223 outputs are active high with a pull-down. One event per rising edge, keys independent.
#[derive(Default)]
pub struct TouchKeys {
    levels: [bool; 2],
}
impl TouchKeys {
    /// Rising edges since the last sample, as `[left, right]`.
    pub fn sample(&mut self, left: bool, right: bool) -> [bool; 2] {
        let next = [left, right];
        let edges = [next[0] && !self.levels[0], next[1] && !self.levels[1]];
        self.levels = next;
        edges
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Tone {
    Key,
    Success,
    Error,
    Notification,
    /// A badge was read and recognised: a quick rising sparkle, near the piezo's resonance.
    Badge,
}
impl Tone {
    /// LEDC square wave at 50 % duty, as `(hz, ms)`. A zero frequency is a silent interval.
    pub fn program(self) -> &'static [(u32, u64)] {
        match self {
            Self::Key => &[(1319, 18), (1568, 12)],
            Self::Success => &[(1047, 40), (0, 18), (1319, 40), (0, 18), (1568, 45), (0, 22), (2093, 65)],
            Self::Error => &[(659, 65), (0, 35), (523, 90)],
            Self::Notification => &[(1568, 35), (0, 30), (1319, 35), (0, 30), (2093, 70)],
            // C7 E7 G7 then C8, legato: a contactless "tiling", brighter and shorter than Success.
            Self::Badge => &[(2093, 26), (2637, 26), (3136, 26), (4186, 90)],
        }
    }
}

/// A press as the terminal reads it: one key, or both together.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Press {
    Left,
    Right,
    Both,
}

/// Presses from the key levels: rising edges, with both keys within `CHORD_MS` as one `Both`.
/// Sample at least every `KEY_POLL_MS`, also when nothing changes, so a lone key comes out.
#[derive(Default)]
pub struct Presses {
    edges: TouchKeys,
    /// The key that rose first, and when, while the other may still join it.
    pending: Option<(usize, u64)>,
    /// After `Both`, until both keys are released: their edges are not presses.
    chord: bool,
}
impl Presses {
    pub fn sample(&mut self, left: bool, right: bool, now_ms: u64) -> Option<Press> {
        const SIDES: [Press; 2] = [Press::Left, Press::Right];
        let rising = self.edges.sample(left, right);
        if self.chord {
            self.chord = left || right;
            return None;
        }
        match self.pending {
            Some((side, _)) if rising[1 - side] => {
                self.pending = None;
                self.chord = true;
                Some(Press::Both)
            }
            // The window passed, or the same key again: the first press stands on its own.
            Some((side, at)) if rising[side] || now_ms.saturating_sub(at) >= CHORD_MS => {
                self.pending = rising[side].then_some((side, now_ms));
                Some(SIDES[side])
            }
            Some(_) => None,
            None if rising == [true, true] => {
                self.chord = true;
                Some(Press::Both)
            }
            None => {
                self.pending = rising.iter().position(|r| *r).map(|side| (side, now_ms));
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_lone_key_waits_for_the_chord_window_and_both_keys_make_one_press() {
        let mut keys = Presses::default();
        let poll = KEY_POLL_MS;
        assert_eq!(keys.sample(true, false, 0), None);
        let mut t = poll;
        while t < CHORD_MS {
            assert_eq!(keys.sample(true, false, t), None);
            t += poll;
        }
        assert_eq!(keys.sample(true, false, t), Some(Press::Left));
        assert_eq!(keys.sample(false, false, t + poll), None);
        // A short tap still counts once the window has passed.
        assert_eq!(keys.sample(false, true, 1000), None);
        assert_eq!(keys.sample(false, false, 1020), None);
        assert_eq!(keys.sample(false, false, 1000 + CHORD_MS), Some(Press::Right));
        // The second key 60 ms later: both, and nothing more until they are released.
        assert_eq!(keys.sample(true, false, 2000), None);
        assert_eq!(keys.sample(true, false, 2040), None);
        assert_eq!(keys.sample(true, true, 2060), Some(Press::Both));
        for t in (2080..3000).step_by(20) {
            assert_eq!(keys.sample(t % 200 != 0, true, t as u64), None);
        }
        assert_eq!(keys.sample(false, false, 3000), None);
        assert_eq!(keys.sample(false, false, 4000), None);
        // Both in the same sample.
        assert_eq!(keys.sample(true, true, 5000), Some(Press::Both));
        assert_eq!(keys.sample(false, false, 5020), None);
        // The same key twice in the window: two presses.
        assert_eq!(keys.sample(true, false, 6000), None);
        assert_eq!(keys.sample(false, false, 6020), None);
        assert_eq!(keys.sample(true, false, 6040), Some(Press::Left));
        assert_eq!(keys.sample(false, false, 6060), None);
        assert_eq!(keys.sample(false, false, 6040 + CHORD_MS), Some(Press::Left));
    }
    #[test]
    fn keys_report_rising_edges_only_and_independently() {
        let mut keys = TouchKeys::default();
        assert_eq!(keys.sample(false, false), [false, false]);
        assert_eq!(keys.sample(true, false), [true, false]);
        for _ in 0..200 {
            assert_eq!(keys.sample(true, false), [false, false]);
        }
        assert_eq!(keys.sample(false, false), [false, false]);
        assert_eq!(keys.sample(true, true), [true, true]);
        assert_eq!(keys.sample(false, true), [false, false]);
        assert_eq!(keys.sample(true, true), [true, false]);
    }
    #[test]
    fn every_wired_gpio_appears_once() {
        let mut gpios: Vec<_> = PINS.iter().map(|pin| pin.gpio).collect();
        gpios.sort();
        gpios.dedup();
        assert_eq!(gpios.len(), PINS.len());
    }
}
