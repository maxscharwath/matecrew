//! Takes the site has not acknowledged yet, and badges it has not been told
//! about. Both survive a reboot: the firmware keeps the queue in NVS.

use crate::contract::Take;
use serde::{Deserialize, Serialize};

/// NVS holds a blob of about 10 kB on the default 24 kB partition. A take
/// serializes to about 150 bytes, so the queue stays well under that.
pub const MAX_TAKES: usize = 40;
/// What the site's status endpoint accepts.
pub const MAX_UNKNOWN_BADGES: usize = 50;

#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
pub struct Queue {
    takes: Vec<Take>,
    unknown_badges: Vec<String>,
}

impl Queue {
    /// A queue that cannot be read starts empty rather than blocking takes.
    pub fn from_bytes(bytes: &[u8]) -> Self {
        serde_json::from_slice(bytes).unwrap_or_default()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    pub fn takes(&self) -> &[Take] {
        &self.takes
    }

    /// Adds a take; when the queue is full the oldest one goes, and is returned.
    pub fn push(&mut self, take: Take) -> Option<Take> {
        let dropped = (self.takes.len() >= MAX_TAKES).then(|| self.takes.remove(0));
        self.takes.push(take);
        dropped
    }

    /// Drops the takes the site is done with.
    pub fn settle(&mut self, done: &[String]) {
        self.takes.retain(|take| !done.contains(&take.id));
    }

    pub fn unknown_badges(&self) -> &[String] {
        &self.unknown_badges
    }

    pub fn note_unknown_badge(&mut self, uid: &str) {
        if !self.unknown_badges.iter().any(|known| known == uid) {
            if self.unknown_badges.len() >= MAX_UNKNOWN_BADGES {
                self.unknown_badges.remove(0);
            }
            self.unknown_badges.push(uid.to_owned());
        }
    }

    pub fn clear_unknown_badges(&mut self) {
        self.unknown_badges.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn take(id: &str) -> Take {
        Take {
            id: id.into(),
            badge_uid: "04A1B2C3".into(),
            item_id: Some("i1".into()),
            at: "2026-10-09T18:25:00Z".into(),
        }
    }

    #[test]
    fn keeps_what_the_site_has_not_acknowledged() {
        let mut queue = Queue::default();
        queue.push(take("a"));
        queue.push(take("b"));
        queue.settle(&["a".into(), "zzz".into()]);
        assert_eq!(queue.takes(), &[take("b")]);
    }

    #[test]
    fn drops_the_oldest_take_when_full() {
        let mut queue = Queue::default();
        for i in 0..MAX_TAKES {
            assert_eq!(queue.push(take(&i.to_string())), None);
        }
        assert_eq!(queue.push(take("new")), Some(take("0")));
        assert_eq!(queue.takes().len(), MAX_TAKES);
        assert_eq!(queue.takes().last(), Some(&take("new")));
    }

    #[test]
    fn notes_each_unknown_badge_once() {
        let mut queue = Queue::default();
        queue.note_unknown_badge("04A1B2C3");
        queue.note_unknown_badge("04A1B2C3");
        assert_eq!(queue.unknown_badges(), &["04A1B2C3".to_owned()]);
    }

    #[test]
    fn survives_a_round_trip_and_garbage() {
        let mut queue = Queue::default();
        queue.push(take("a"));
        queue.note_unknown_badge("04A1B2C3");
        assert_eq!(Queue::from_bytes(&queue.to_bytes()), queue);
        assert_eq!(Queue::from_bytes(b"\xff\xff"), Queue::default());
    }

    #[test]
    fn a_full_queue_fits_in_an_nvs_blob() {
        let mut queue = Queue::default();
        for i in 0..MAX_TAKES {
            let mut t = take(&format!("{i:016x}"));
            t.item_id = Some("cmgk3v2xq0001abcd1234efgh".into());
            t.badge_uid = "04A1B2C3D4E5F6".into();
            queue.push(t);
        }
        assert!(queue.to_bytes().len() < 8000, "{} bytes", queue.to_bytes().len());
    }
}
