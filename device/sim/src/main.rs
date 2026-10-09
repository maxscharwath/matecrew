//! Renders every screen of the terminal to PNG in `device/sim/out/`, in about a second.
//!
//! `cargo run` once, or `cargo watch -w ../ui -w src -x run` to redraw on every save.

use embedded_graphics::{pixelcolor::BinaryColor, prelude::*};
use embedded_graphics_simulator::{BinaryColorTheme, OutputSettingsBuilder, SimulatorDisplay};
use matecrew_ui as ui;
use std::{fs, path::Path};

fn main() {
    let out = Path::new(env!("CARGO_MANIFEST_DIR")).join("out");
    fs::create_dir_all(&out).expect("create out/");

    let setup = ui::SetupInfo {
        ap_ssid: "matecrew-setup-50E4",
        ap_password: "k7m2xq9pab",
        portal_url: "http://192.168.71.1",
    };

    save(&out, "test", |d| ui::test_screen(d));
    save(&out, "setup", |d| ui::setup_screen(d, &setup));
    save(&out, "link", |d| {
        ui::link_screen(
            d,
            &ui::LinkInfo {
                code: "QFH7-FXRT",
                url: "matecrew.vercel.app/link",
                url_with_code: "https://matecrew.vercel.app/link?code=QFH7-FXRT",
            },
        )
    });
    save(&out, "linked", |d| ui::linked_screen(d, "Lausanne", "Terminal Lausanne"));
    save(&out, "connecting", |d| ui::connecting_screen(d, "OWT-Office"));
    save(&out, "connected", |d| ui::connected_screen(d, "OWT-Office", "10.0.4.27"));
    save(&out, "error", |d| {
        ui::error_screen(d, "Wi-Fi introuvable", "Le réseau « OWT-Office » ne répond pas.")
    });
}

fn save(
    dir: &Path,
    name: &str,
    draw: impl FnOnce(&mut SimulatorDisplay<BinaryColor>) -> Result<(), core::convert::Infallible>,
) {
    let mut display = SimulatorDisplay::<BinaryColor>::new(Size::new(ui::WIDTH, ui::HEIGHT));
    draw(&mut display).unwrap();
    let settings = OutputSettingsBuilder::new()
        .theme(BinaryColorTheme::Custom {
            color_off: embedded_graphics::pixelcolor::Rgb888::new(0xF4, 0xF2, 0xEC),
            color_on: embedded_graphics::pixelcolor::Rgb888::new(0x1D, 0x1D, 0x1F),
        })
        .build();
    let path = dir.join(format!("{name}.png"));
    display
        .to_rgb_output_image(&settings)
        .save_png(&path)
        .expect("write png");
    println!("{}", path.display());
}
