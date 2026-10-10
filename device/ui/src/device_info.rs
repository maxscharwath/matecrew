//! Host metadata shared by built-in screens and SDK apps; no server-rendered pixels.
use crate::status_icons;
use matecrew_core::{contract::DeviceState, time};
use serde_json::{json, Value};
use std::sync::{OnceLock, RwLock};
fn storage() -> &'static RwLock<Value> {
    static INFO: OnceLock<RwLock<Value>> = OnceLock::new();
    INFO.get_or_init(|| RwLock::new(decorate(json!({}))))
}
pub fn get() -> Value {
    storage().read().expect("device info lock").clone()
}
/// Decorate host readings with compiled icon assets. Missing battery data stays unknown.
fn decorate(mut info: Value) -> Value {
    if !info.is_object() {
        return json!({});
    }
    let wifi = match info["wifi"]["rssi"].as_i64() {
        None => status_icons::WIFI_OFF,
        Some(rssi) if rssi >= -55 => status_icons::WIFI_3,
        Some(rssi) if rssi >= -70 => status_icons::WIFI_2,
        Some(rssi) if rssi >= -85 => status_icons::WIFI_1,
        _ => status_icons::WIFI_0,
    };
    let percent = info["battery"]["percent"].as_u64().filter(|p| *p <= 100);
    let battery = match percent {
        Some(67..=100) => status_icons::BATTERY_FULL,
        Some(34..=66) => status_icons::BATTERY_MEDIUM,
        Some(1..=33) => status_icons::BATTERY_LOW,
        _ => status_icons::BATTERY_EMPTY,
    };
    info["status"] = json!({"wifi":wifi,"battery":battery,"batteryUnknown":if percent.is_none() {"?"} else {""},"batteryText":percent.map_or_else(|| "—".to_owned(), |percent| format!("{percent}%"))});
    info
}
pub fn set(info: Value) -> Value {
    let info = decorate(info);
    *storage().write().expect("device info lock") = info.clone();
    info
}
/// Advance the API's office-local clock using the device's UTC time.
/// No extra redraw timer: e-ink shows the time at the last refresh.
pub fn clock(state: Option<&DeviceState>, unix: i64) -> String {
    let Some(state) = state else {
        return "--:--".into();
    };
    let Some(reference) = time::parse_iso(&state.server_time) else {
        return "--:--".into();
    };
    let Some((hours, minutes)) = state.screen.as_ref().and_then(|s| s.time.split_once(':')) else {
        return "--:--".into();
    };
    let Some((h, m)) = hours
        .parse::<i64>()
        .ok()
        .zip(minutes.parse::<i64>().ok())
        .filter(|(h, m)| (0..24).contains(h) && (0..60).contains(m))
    else {
        return "--:--".into();
    };
    if unix < reference {
        return format!("{h:02}:{m:02}");
    }
    let elapsed_minutes = (unix - reference + reference.rem_euclid(60)) / 60;
    let minute = (h * 60 + m + elapsed_minutes).rem_euclid(1440);
    format!("{:02}:{:02}", minute / 60, minute % 60)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_battery_and_disconnected_wifi_are_explicit() {
        let info = decorate(json!({"wifi":{"rssi":null},"battery":{"percent":null}}));
        assert_eq!(info["status"]["batteryUnknown"], "?");
        assert_eq!(info["status"]["wifi"], json!(status_icons::WIFI_OFF));
        let info = decorate(json!({"wifi":{"rssi":-60},"battery":{"percent":80}}));
        assert_eq!(info["status"]["batteryUnknown"], "");
        assert_eq!(info["status"]["wifi"], json!(status_icons::WIFI_2));
        assert_eq!(info["status"]["battery"], json!(status_icons::BATTERY_FULL));
    }
}
