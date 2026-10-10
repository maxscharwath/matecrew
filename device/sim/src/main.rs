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
    for stage in 0..4 {
        save(&out, &format!("boot-{stage}"), |d| ui::boot::render(d, stage));
    }

    let info = ui::device_info::set(
        serde_json::json!({"board":{"name":"Simulateur XIAO","simulated":true},"pins":{"left":5,"right":8,"buzzer":6},"wifi":{"rssi":-55},"battery":{"percent":78},"clock":"10:42"}),
    );
    let setup = ui::SetupInfo {
        ap_ssid: "matecrew-setup-50E4",
        ap_password: "k7m2xq9pab",
        portal_url: "http://192.168.71.1",
        bluetooth: "matecrew-50E4 · 482913",
    };

    let mut dashboard =
        serde_json::from_str(include_str!("../../fixtures/dashboard.json")).unwrap();
    save(&out, "main", |d| ui::dashboard_screen(d, &dashboard, false));
    for (name, theme) in [
        ("flipper", ui::Theme::Flipper),
        ("macos", ui::Theme::Macos),
        ("dark", ui::Theme::Dark),
    ] {
        ui::set_theme(theme);
        save(&out, &format!("theme-{name}"), |d| {
            ui::dashboard_screen(d, &dashboard, false)
        });
        save(&out, &format!("feedback-{name}"), |d| {
            ui::badge_screen(d, "Prendre")
        });
    }
    let mut showcase_app = ui::apps::showcase().expect("showcase bytecode");
    showcase_app.update_device(info);
    showcase_app.update(
        "showcase",
        serde_json::json!({"office":{"name":"Lausanne · données API"}}),
    );
    for name in [
        "home",
        "components",
        "charts",
        "area",
        "icons",
        "media",
        "themes",
        "state",
        "hardware",
    ] {
        for request in showcase_app.image_requests() {
            showcase_app
                .update_image(
                    &request,
                    include_bytes!("../../../public/device/streamline-coffee.png"),
                )
                .unwrap();
        }
        save(&out, &format!("showcase-{name}"), |d| {
            showcase_app.scene().render(d, showcase_app.data(), 2)
        });
        if name == "hardware" {
            showcase_app.tick(100);
            showcase_app.press(ui::engine::Point::new(80, 194));
            save(&out, "showcase-toast", |d| {
                showcase_app.scene().render(d, showcase_app.data(), 2)
            });
            showcase_app.tick(5100);
            showcase_app.press(ui::engine::Point::new(280, 194));
            save(&out, "showcase-dialog", |d| {
                showcase_app.scene().render(d, showcase_app.data(), 2)
            });
            showcase_app.input("left");
        }
        showcase_app.input("right").expect("next key binding");
    }
    ui::set_theme(ui::Theme::Flipper);
    save(&out, "main-offline", |d| {
        ui::dashboard_screen(d, &dashboard, true)
    });
    for count in [0, 1, 6, 9, 20] {
        let mut layout = dashboard.clone();
        layout.items = (0..count)
            .map(|i| {
                let mut item = dashboard.items[i % 3].clone();
                item.name = format!("Article {}", i + 1);
                item
            })
            .collect();
        save(&out, &format!("main-{count}"), |d| {
            ui::dashboard_screen(d, &layout, false)
        });
    }
    dashboard.preparation = serde_json::from_str(r#"{"title":"À préparer · Après-midi","total":"8 à préparer","items":[{"name":"Maté Classic","count":5,"names":"Alex, Sam, Chris, Jo, Max","image":""},{"name":"Maté Zero","count":3,"names":"Pat, Robin, Mika","image":""}]}"#).unwrap();
    save(&out, "preparation", |d| {
        ui::dashboard_screen(d, &dashboard, false)
    });

    let app =
        ui::engine::Scene::from_bytecode(include_bytes!("../../dist/hello.dui")).unwrap();
    let mut app_runtime = ui::engine::Runtime::new(app.clone()).unwrap();
    app_runtime.update("stock", serde_json::json!({"office":{"name":"Lausanne"},"items":[{"name":"Maté Classic","stock":36}],"screen":{"chart":{"series":[[48,45,46,39,36]],"max":50}}}));
    save(&out, "tsx-app", |d| app.render(d, app_runtime.data(), 2));
    app_runtime.handle("action1");
    save(&out, "tsx-app-state", |d| {
        app.render(d, app_runtime.data(), 2)
    });

    save(&out, "setup", |d| ui::setup_screen(d, &setup));
    save(&out, "link", |d| {
        ui::link_screen(
            d,
            &ui::LinkInfo {
                code: "QFH7-FXRT",
                url: "matecrew.vercel.app/link",
                url_with_code: "https://matecrew.vercel.app/link?code=QFH7-FXRT",
                bluetooth: "matecrew-50E4 · 482913",
            },
        )
    });
    save(&out, "linked", |d| {
        ui::linked_screen(d, "Lausanne", "Terminal Lausanne")
    });
    save(&out, "connecting", |d| {
        ui::connecting_screen(d, "OWT-Office")
    });
    save(&out, "connected", |d| {
        ui::connected_screen(d, "OWT-Office", "10.0.4.27")
    });
    save(&out, "badge", |d| ui::badge_screen(d, "Prendre"));
    let image = matecrew_core::contract::decode_base64(&dashboard.items[0].image).unwrap();
    let info = ui::PickInfo {
        name: "Alex",
        item: "Maté Classic",
        stock: 36,
        image: Some(&image),
        index: 0,
        count: 3,
    };
    save(&out, "pick", |d| ui::pick_screen(d, &info));
    save(&out, "leave", |d| ui::leave_screen(d, "Alex"));
    save(&out, "taken", |d| {
        ui::taken_screen(d, "Alex", "Maté Classic", Some(&image))
    });
    let labels = ["ven", "sam", "dim", "lun", "mar", "mer", "jeu"].map(String::from);
    save(&out, "summary", |d| {
        ui::summary_screen(
            d,
            &ui::SummaryInfo {
                name: "Alex Martin",
                today: 1,
                week: 4,
                month: 11,
                days: &[1, 0, 0, 2, 0, 1, 1].map(|n| vec![n]),
                products: &["Maté Classic".to_owned()],
                labels: &labels,
                cost: Some("CHF 12.40"),
            },
        )
    });
    save(&out, "update", |d| ui::update_screen(d, "0.2.0", 50));
    save(&out, "unknown-badge", |d| {
        ui::unknown_badge_screen(d, "04A1B2C3D4E5F6", None)
    });
    let claim = "https://matecrew.vercel.app/badge?d=cmv1eex25001zieyucz0rillv&u=04A1B2C3D4E5F6&t=1791570300&s=1XA8_wdH3MGEW6rDCHsTew";
    save(&out, "claim-badge", |d| {
        ui::unknown_badge_screen(d, "04A1B2C3D4E5F6", Some(claim))
    });
    save(&out, "error", |d| {
        ui::error_screen(
            d,
            "Wi-Fi introuvable",
            "Le réseau « OWT-Office » ne répond pas.",
        )
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
        .scale(1)
        .pixel_spacing(0)
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
