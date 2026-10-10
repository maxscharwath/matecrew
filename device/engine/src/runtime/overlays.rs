//! Transient device-local notifications. No network, persistence, or background JS required.
use super::Runtime;
use serde_json::{json, Value};
impl Runtime {
    /// Advance the monotonic UI clock independently of network polling.
    pub fn tick(&mut self, now_ms: u64) -> bool {
        self.now_ms = self.now_ms.max(now_ms);
        if self.toast_deadline.is_some_and(|at| self.now_ms >= at) {
            self.toast_deadline = None;
            self.data["$overlay"]["toast"] = Value::Null;
            true
        } else {
            false
        }
    }
    pub fn overlay_deadline(&self) -> Option<u64> {
        self.toast_deadline
    }
    /// Hosts can inject a notification at any time, including a background data update.
    /// One visible toast: a newer notification replaces the old one and resets its deadline.
    pub fn notify(&mut self, message: &str, duration_ms: u32, now_ms: u64) -> bool {
        if message.is_empty() || message.len() > 256 || !(1000..=60000).contains(&duration_ms) {
            return false;
        }
        self.tick(now_ms);
        self.data["$overlay"]["toast"] = json!({"visible":true,"message":message});
        self.toast_deadline = Some(self.now_ms.saturating_add(duration_ms as u64));
        true
    }
    pub(super) fn choose_dialog(&mut self, confirm: bool) -> Vec<crate::Effect> {
        let action = self.data["$overlay"]["dialog"]["onConfirm"]
            .as_str()
            .map(str::to_owned);
        // Clear first: confirmations cannot replay, even if their action opens another dialog.
        self.data["$overlay"]["dialog"] = Value::Null;
        if confirm {
            action.map_or_else(Vec::new, |action| self.handle(&action))
        } else {
            vec![]
        }
    }
}
