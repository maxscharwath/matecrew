//! Board signals shared by the ESP32 GPIO adapter and the Wasm simulator.
use crate::{contract::Side, flow::Beep};
pub const KEY_LEFT_GPIO: u8 = 5;
pub const KEY_RIGHT_GPIO: u8 = 8;
pub const BUZZER_GPIO: u8 = 44;
pub const KEY_POLL_MS: u64 = 20;

#[derive(Default)]
pub struct TouchKeys {
    levels: [bool; 2],
}
impl TouchKeys {
    /// Active high with pull-down. One event per rising edge, including simultaneous keys.
    pub fn sample(&mut self, left: bool, right: bool) -> [Option<Side>; 2] {
        let next = [left, right];
        let edges = [Side::Left, Side::Right].map(|side| {
            let i = if side == Side::Left { 0 } else { 1 };
            (next[i] && !self.levels[i]).then_some(side)
        });
        self.levels = next;
        edges
    }
}
impl Beep {
    /// LEDC square wave at 50% duty. A zero frequency is a silent interval.
    pub fn tones(self) -> &'static [(u32, u64)] {
        match self {
            Self::Key => &[(1319, 18), (1568, 12)],
            Self::Accepted => &[(1047, 40), (0, 18), (1319, 40), (0, 18), (1568, 45), (0, 22), (2093, 65)],
            Self::Error => &[(659, 65), (0, 35), (523, 90)],
            Self::Notification => &[(1568, 35), (0, 30), (1319, 35), (0, 30), (2093, 70)],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gpio_edges_hold_release_and_simultaneous_input() {
        let mut keys = TouchKeys::default();
        assert_eq!(keys.sample(false, false), [None, None]);
        assert_eq!(keys.sample(true, false), [Some(Side::Left), None]);
        for _ in 0..200 {
            assert_eq!(keys.sample(true, false), [None, None]);
        }
        assert_eq!(keys.sample(false, false), [None, None]);
        assert_eq!(
            keys.sample(true, true),
            [Some(Side::Left), Some(Side::Right)]
        );
        assert_eq!(keys.sample(false, true), [None, None]);
        assert_eq!(keys.sample(true, true), [Some(Side::Left), None]);
    }
}
