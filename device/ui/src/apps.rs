//! Bundled application entry points. App selection belongs to the host, not the engine.
pub const SHOWCASE: &[u8] = include_bytes!("../../apps/showcase/app.dui");
pub fn showcase() -> Result<crate::engine::Runtime, &'static str> {
    crate::engine::Runtime::new(crate::engine::Scene::from_bytecode(SHOWCASE)?)
}
