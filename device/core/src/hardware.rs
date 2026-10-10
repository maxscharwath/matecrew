//! The board crate seen from the take flow: keys as sides, beeps as tone programs.
use crate::{
    contract::Side,
    flow::{Beep, Event},
};
pub use device_board::{BUZZER_GPIO, CHORD_MS, KEY_LEFT_GPIO, KEY_POLL_MS, KEY_RIGHT_GPIO, LONG_MS};

/// The board's key reader: presses as flow events, a key held long as `LongKey`, both keys
/// together as `BothKeys`.
#[derive(Default)]
pub struct TouchKeys(device_board::Presses);
impl TouchKeys {
    /// Active high with pull-down, sampled every `KEY_POLL_MS` with the time in milliseconds.
    /// A key comes out when it is released, or as a long press once held `LONG_MS`.
    pub fn sample(&mut self, left: bool, right: bool, now_ms: u64) -> Option<Event> {
        self.0.sample(left, right, now_ms).map(|press| match press {
            device_board::Press::Left => Event::Key { side: Side::Left },
            device_board::Press::Right => Event::Key { side: Side::Right },
            device_board::Press::Both => Event::BothKeys,
            device_board::Press::LongLeft => Event::LongKey { side: Side::Left },
            device_board::Press::LongRight => Event::LongKey { side: Side::Right },
        })
    }
}
impl Beep {
    /// LEDC square wave at 50% duty. A zero frequency is a silent interval.
    pub fn tones(self) -> &'static [(u32, u64)] {
        device_board::Tone::from(self).program()
    }
}
impl From<Beep> for device_board::Tone {
    fn from(beep: Beep) -> Self {
        match beep {
            Beep::Key => Self::Key,
            Beep::Accepted => Self::Success,
            Beep::Error => Self::Error,
            Beep::Notification => Self::Notification,
            Beep::Badge => Self::Badge,
            Beep::Boot => Self::Boot,
            Beep::Unknown => Self::Unknown,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys_become_flow_events_and_both_keys_open_the_about_page() {
        let mut keys = TouchKeys::default();
        let left = Some(Event::Key { side: Side::Left });
        assert_eq!(keys.sample(true, false, 0), None);
        assert_eq!(keys.sample(false, false, CHORD_MS), left);
        assert_eq!(keys.sample(false, true, 500), None);
        assert_eq!(keys.sample(false, true, 500 + LONG_MS), Some(Event::LongKey { side: Side::Right }));
        assert_eq!(keys.sample(false, false, 1600), None);
        assert_eq!(keys.sample(false, true, 2000), None);
        assert_eq!(keys.sample(true, true, 2040), Some(Event::BothKeys));
        assert_eq!(keys.sample(false, false, 3000), None);
        assert_eq!(keys.sample(false, false, 4000), None);
    }
}
