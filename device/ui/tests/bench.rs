//! Where drawing a main screen spends its time, on the host: `cargo test --release --test
//! bench -- --ignored --nocapture`. The terminal is about 30 times slower; its log prints the
//! same split ("drawn in").
use matecrew_core::contract::DeviceScreen;
use matecrew_ui::{dashboard::dashboard_screen, frame::Frame};
use std::time::Instant;

/// The fixture with `count` items, each with a 96 x 96 picture and its opacity plane.
fn screen(count: usize) -> DeviceScreen {
    let mut screen: DeviceScreen =
        serde_json::from_str(include_str!("../../fixtures/dashboard.json")).unwrap();
    let base = screen.items[0].clone();
    let planes: Vec<u8> = (0..2304).map(|i| (i * 37 % 251) as u8).collect();
    let encoded = base64(&planes);
    screen.items = (0..count)
        .map(|i| {
            let mut item = base.clone();
            item.name = format!("El Tony · Mate {i}");
            item.picture = encoded.clone();
            item
        })
        .collect();
    screen
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
        for i in 0..4 {
            out.push(if i <= chunk.len() {
                TABLE[(n >> (18 - 6 * i) & 63) as usize] as char
            } else {
                '='
            });
        }
    }
    out
}

#[test]
#[ignore]
fn main_screens() {
    for count in [1, 3, 4, 6] {
        let data = screen(count);
        let mut frame = Frame::new();
        dashboard_screen(&mut frame, &data, false).unwrap();
        let rounds = 50;
        let started = Instant::now();
        for _ in 0..rounds {
            dashboard_screen(&mut frame, &data, false).unwrap();
        }
        println!(
            "{count} items: {:.2} ms per screen",
            started.elapsed().as_secs_f64() * 1000.0 / rounds as f64
        );
    }
}
