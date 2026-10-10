//! `cargo run --release --example render-bench`: end-to-end data update + local 800x480 rendering.
use device_engine::{frame::Frame, Runtime, Scene};
use serde_json::json;
use std::time::Instant;
fn main() {
    let scene = Scene::from_bytecode(include_bytes!("../tests/fixtures/app.dui")).unwrap();
    let mut app = Runtime::new(scene).unwrap();
    let mut frame = Frame::new(800, 480).unwrap();
    const FRAMES: u32 = 500;
    for i in 0..20 {
        app.update("stock",json!({"office":{"name":"Inventory"},"items":[{"name":"Very long product label","stock":i}],"screen":{"chart":{"series":[[48,44,36]],"max":50}}}));
        app.scene().render(&mut frame, app.data(), 4).unwrap();
    }
    let started = Instant::now();
    for i in 0..FRAMES {
        app.update("stock",json!({"office":{"name":"Inventory"},"items":[{"name":"Very long product label","stock":i%100}],"screen":{"chart":{"series":[[48,44,36]],"max":50}}}));
        app.scene().render(&mut frame, app.data(), 4).unwrap();
        std::hint::black_box(&frame.bits);
    }
    println!(
        "{FRAMES} update + render frames: {:?}; mean: {:?}; framebuffer: {} bytes",
        started.elapsed(),
        started.elapsed() / FRAMES,
        frame.bits.len()
    );
}
