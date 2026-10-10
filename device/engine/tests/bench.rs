//! Render cost of the real maté screens with their preview data: the CPU time the terminal stays
//! awake for each screen. `cargo test --release --test bench -- --ignored --nocapture`.
use device_engine::{frame::Frame, Scene, Theme};
use serde_json::Value;
use std::time::Instant;

/// `BENCH_ROUNDS` and `BENCH_ONLY` (a preview name) let a profiler watch one screen for long.
fn rounds() -> u32 {
    std::env::var("BENCH_ROUNDS")
        .ok()
        .and_then(|r| r.parse().ok())
        .unwrap_or(200)
}

#[test]
#[ignore = "a measurement, not a check"]
fn render_cost_of_the_mate_screens() {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/..");
    let previews: Value = serde_json::from_str(
        &std::fs::read_to_string(format!("{root}/apps/mate/previews.json")).unwrap(),
    )
    .unwrap();
    let mut total = 0.0;
    let mut decode_total = 0.0;
    let mut count = 0;
    let only = std::env::var("BENCH_ONLY").ok();
    for (name, preview) in previews.as_object().unwrap() {
        if only.as_deref().is_some_and(|only| only != name) {
            continue;
        }
        let screen = preview["screen"].as_str().unwrap();
        let bytes = std::fs::read(format!("{root}/dist/mate/{screen}.dui")).unwrap();
        let started = Instant::now();
        let scene = Scene::from_bytecode(&bytes).unwrap();
        let decode = started.elapsed().as_secs_f64() * 1e6;
        let data = &preview["data"];
        let mut frame = Frame::new(800, 480).unwrap();
        scene
            .render_with_theme(&mut frame, data, 1, Theme::Paper)
            .unwrap();
        let started = Instant::now();
        for _ in 0..rounds() {
            frame = Frame::new(800, 480).unwrap();
            scene
                .render_with_theme(&mut frame, data, 1, Theme::Paper)
                .unwrap();
        }
        let micros = started.elapsed().as_secs_f64() * 1e6 / f64::from(rounds());
        println!("{name:<16} {micros:>8.0} µs render  {decode:>6.0} µs decode");
        total += micros;
        decode_total += decode;
        count += 1;
    }
    println!(
        "mean             {:>8.0} µs render  {:>6.0} µs decode",
        total / count as f64,
        decode_total / count as f64
    );
}
