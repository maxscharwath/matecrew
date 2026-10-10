//! System notifications shared by built-in maté screens and downloaded SDK apps.
use crate::{engine, Theme};
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*};
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
    if layer.overlay_deadline().is_none() {
        return Ok(());
    }
    layer
        .scene()
        .render_layer(target, layer.data(), crate::app_scale(layer.scene()), theme)
}
