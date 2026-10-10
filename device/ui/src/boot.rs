//! A finite boot sequence, shared by the physical panel and Wasm host.
use crate::{engine, Theme, SCALE};
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*};
use serde_json::json;
use std::sync::OnceLock;

pub fn render<D: DrawTarget<Color = BinaryColor>>(target: &mut D, stage: u8) -> Result<(), D::Error> {
    static SCENE: OnceLock<engine::Scene> = OnceLock::new();
    let scene = SCENE.get_or_init(|| engine::Scene::from_bytecode(include_bytes!("../../screens/boot.dui")).expect("boot screen"));
    let i = usize::from(stage.min(3));
    let progress = [12, 38, 72, 100][i];
    let label = ["Réveil du système", "Connexion au réseau", "Chargement des apps", "Tout est prêt"][i];
    scene.render_with_theme(target, &json!({"boot":{"title":"matécrew", "progress":progress,"stage":label,"step":format!("0{} / 04", i+1)}}), SCALE, Theme::Flipper)
}
