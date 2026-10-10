//! Host metadata shared by built-in screens and SDK apps; no server-rendered pixels.
use crate::status_icons;
use matecrew_core::{
    contract::DeviceState,
    power::{Power, LOW_PERCENT},
    time,
};
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
/// Hosts send `battery.millivolts` and `battery.usb`; a host that only knows a percent may
/// send it instead (previews, the site's virtual terminal).
pub(crate) fn decorate(mut info: Value) -> Value {
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
    let reading = &info["battery"];
    let power = Power {
        millivolts: reading["millivolts"].as_u64().and_then(|mv| u16::try_from(mv).ok()),
        usb: reading["usb"].as_bool().unwrap_or(false) || reading["charging"] == true,
    };
    let percent = reading["percent"]
        .as_u64()
        .filter(|p| *p <= 100)
        .map(|p| p as u8)
        .or_else(|| power.percent());
    // Charging only shows when the charge is known: without the battery divider the terminal
    // only knows it runs on USB, and shows the plug alone.
    let charging = power.usb && percent.is_some_and(|p| p < 100);
    let low = !power.usb && percent.is_some_and(|p| p <= LOW_PERCENT);
    let battery = match percent {
        _ if charging => status_icons::BATTERY_CHARGING,
        _ if power.usb => status_icons::PLUGGED,
        Some(p) if p <= LOW_PERCENT => status_icons::BATTERY_WARNING,
        Some(67..=100) => status_icons::BATTERY_FULL,
        Some(34..=66) => status_icons::BATTERY_MEDIUM,
        Some(_) => status_icons::BATTERY_LOW,
        None => status_icons::BATTERY_EMPTY,
    };
    let text = match percent {
        Some(percent) => format!("{percent}%"),
        None if power.usb => String::new(),
        None => "--".to_owned(),
    };
    info["battery"] = json!({
        "millivolts": power.millivolts,
        "percent": percent,
        "usb": power.usb,
        "charging": charging,
        "low": low,
    });
    info["status"] = json!({
        "wifi": wifi,
        "battery": battery,
        "batteryUnknown": if percent.is_none() { "?" } else { "" },
        "batteryText": text,
        "charging": charging,
        "low": low,
    });
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
    let Some((hours, minutes)) = state.screen.time.split_once(':') else {
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
    #[test]
    fn battery_reads_from_millivolts_and_shows_charging() {
        let info = decorate(json!({"battery":{"millivolts":3950}}));
        assert_eq!(info["battery"]["percent"], 70);
        assert_eq!(info["status"]["batteryText"], "70%");
        assert_eq!(info["status"]["battery"], json!(status_icons::BATTERY_FULL));
        let info = decorate(json!({"battery":{"millivolts":4020,"usb":true}}));
        assert_eq!(info["status"]["charging"], true);
        assert_eq!(info["status"]["battery"], json!(status_icons::BATTERY_CHARGING));
        let info = decorate(json!({"battery":{"millivolts":4200,"usb":true}}));
        assert_eq!(info["status"]["charging"], false);
        assert_eq!(info["status"]["battery"], json!(status_icons::PLUGGED));
        let info = decorate(json!({"battery":{"millivolts":3600}}));
        assert_eq!(info["status"]["low"], true);
        assert_eq!(info["status"]["battery"], json!(status_icons::BATTERY_WARNING));
        let info = decorate(json!({"battery":{"usb":true}}));
        assert_eq!(
            info["status"]["batteryText"], "",
            "the plug says it, no text"
        );
        assert_eq!(info["status"]["battery"], json!(status_icons::PLUGGED));
        assert_eq!(info["status"]["charging"], false);
    }
}
