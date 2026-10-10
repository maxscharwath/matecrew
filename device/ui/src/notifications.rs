//! System notifications shared by built-in maté screens and downloaded SDK apps.
use crate::{engine, Theme};
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*};
use serde_json::json;
use std::sync::{Mutex, OnceLock};
fn layer() -> &'static Mutex<engine::Runtime> {
    static LAYER: OnceLock<Mutex<engine::Runtime>> = OnceLock::new();
    LAYER.get_or_init(|| {
        Mutex::new(
            engine::Runtime::new(
                engine::Scene::from_bytecode(include_bytes!("../../dist/system/notification.dui"))
                    .expect("system layer bytecode"),
            )
            .expect("system layer"),
        )
    })
}
/// The passkey a browser pairing over Bluetooth waits for, shown over every screen until the
/// pairing ends (`pairing(None)`).
static PASSKEY: Mutex<Option<u32>> = Mutex::new(None);

/// Shows (`Some`) or hides (`None`) the Bluetooth pairing code; true when that changed the layer.
pub fn pairing(passkey: Option<u32>) -> bool {
    let mut shown = PASSKEY.lock().expect("passkey lock");
    let changed = *shown != passkey;
    *shown = passkey;
    changed
}

pub fn notify(message: &str, duration_ms: u32, now_ms: u64) -> bool {
    layer()
        .lock()
        .expect("system layer lock")
        .notify(message, duration_ms, now_ms)
}
pub fn tick(now_ms: u64) -> bool {
    layer().lock().expect("system layer lock").tick(now_ms)
}
pub fn deadline() -> Option<u64> {
    layer()
        .lock()
        .expect("system layer lock")
        .overlay_deadline()
}
/// A reboot clears transient notifications and restarts their monotonic clock.
pub fn reset() {
    let mut runtime = layer().lock().expect("system layer lock");
    *runtime = engine::Runtime::new(runtime.scene().clone()).expect("system layer");
}
pub fn render<D: DrawTarget<Color = BinaryColor>>(
    target: &mut D,
    theme: Theme,
) -> Result<(), D::Error> {
    let layer = layer().lock().expect("system layer lock");
    let passkey = *PASSKEY.lock().expect("passkey lock");
    if layer.overlay_deadline().is_none() && passkey.is_none() {
        return Ok(());
    }
    let mut data = layer.data().clone();
    if let Some(passkey) = passkey {
        // Read in two groups of three, as phones and computers show it.
        data["pairing"] = json!({"first": format!("{:03}", passkey / 1000), "last": format!("{:03}", passkey % 1000)});
    }
    data["$device"] = json!({"locale": crate::locale()});
    layer.scene().render_layer(target, &data, crate::app_scale(layer.scene()), theme)
}
