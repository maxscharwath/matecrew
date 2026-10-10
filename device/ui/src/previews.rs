//! The maté app's previews, taken from the real screen adapters so `dui render` and `dui test`
//! draw exactly the data the firmware passes. Writes `apps/mate/previews.json` when
//! `UPDATE_PREVIEWS=1`, and fails when the committed file differs.
use crate::*;
use matecrew_core::contract::{decode_base64, DeviceScreen};
use serde_json::{json, Map, Value};
use std::cell::RefCell;

thread_local! {
    static LAST: RefCell<Option<(String, Value)>> = const { RefCell::new(None) };
}
pub(crate) fn record(screen: &str, data: &Value) {
    LAST.set(Some((screen.to_owned(), data.clone())));
}

/// Host metadata every preview shows, set per capture rather than through the shared global.
fn simulated_device() -> Value {
    device_info::decorate(json!({
        "board":{"name":"Simulateur XIAO","simulated":true},
        "pins":{"left":5,"right":8,"buzzer":6},
        "firmware":{"version":"0.3.0","build":"2026-10-10 09:12 UTC","commit":"546a98a","slot":"ota_0"},
        "site":"matecrew.vercel.app",
        "device":{"id":"cmv1eex25001zieyucz0rillv","name":"Terminal Lausanne"},
        "chip":{"model":"ESP32-S3","id":"ACA704123456"},
        "bluetooth":"matecrew-50E4 · 482913",
        "wifi":{"rssi":-55,"ssid":"OWT-Office","ip":"10.0.4.27","mac":"AC:A7:04:12:34:56"},
        "battery":{"millivolts":4004,"usb":false},
        "uptimeMinutes":134,
        "clock":"10:42"
    }))
}

struct Collector(Map<String, Value>);
impl Collector {
    fn add(
        &mut self,
        name: &str,
        description: &str,
        draw: impl FnOnce(&mut frame::Frame) -> Result<(), core::convert::Infallible>,
    ) {
        LAST.set(None);
        draw(&mut frame::Frame::new()).unwrap();
        let (screen, mut data) = LAST.take().expect("the adapter drew a built-in screen");
        data["$device"] = simulated_device();
        self.0.insert(
            name.into(),
            json!({"screen": screen, "description": description, "data": data}),
        );
    }
}

fn previews() -> Value {
    let mut dashboard: DeviceScreen =
        serde_json::from_str(include_str!("../../fixtures/dashboard.json")).unwrap();
    let image = decode_base64(&dashboard.items[0].image).unwrap();
    let mut all = Collector(Map::new());
    all.add("stock", "Three items, the usual office", |d| dashboard_screen(d, &dashboard, false));
    all.add("stock-offline", "Same, without network", |d| dashboard_screen(d, &dashboard, true));
    for count in [0, 1, 2, 4, 5, 6, 9, 20] {
        let mut layout = dashboard.clone();
        layout.items = (0..count)
            .map(|i| {
                let mut item = dashboard.items[i % 3].clone();
                item.name = format!("Article {}", i + 1);
                item
            })
            .collect();
        // One line per shown item, as the site sends them.
        if let Some(chart) = &mut layout.chart {
            let lines = chart.series.clone();
            chart.series = (0..count.min(6)).map(|i| lines[i % lines.len()].clone()).collect();
        }
        all.add(&format!("stock-{count}"), &format!("{count} items"), |d| {
            dashboard_screen(d, &layout, false)
        });
    }
    let picture = |i: usize| dashboard.items[i % dashboard.items.len()].image.clone();
    dashboard.preparation = Some(serde_json::from_value(json!({
        "title":"À préparer · Après-midi","total":"9 à préparer","sessionId":"s1","serveLabel":"Servi",
        "items":[
            {"name":"Maté Classic","count":5,"names":"Alex, Sam, Chris, Jo, Max","image":picture(0)},
            {"name":"Maté Zero","count":3,"names":"Pat, Robin, Mika","image":picture(1)},
            {"name":"Maté Ginger","count":1,"names":"Lou","image":picture(2)}
        ]
    })).unwrap());
    all.add("preparation", "Before a session: who takes what; the right key serves it", |d| dashboard_screen(d, &dashboard, false));
    all.add("badge-serve", "Servi: the runner's badge", |d| badge_screen(d, "Servi"));
    all.add("served", "The site served the session", |d| served_screen(d, "Alex", 9));
    all.add("setup", "First start: join the setup Wi-Fi", |d| {
        setup_screen(d, &SetupInfo { ap_ssid: "matecrew-setup-50E4", ap_password: "k7m2xq9pab", portal_url: "http://192.168.71.1", bluetooth: "matecrew-50E4 · 482913" })
    });
    all.add("link", "Waiting for an admin to approve the code", |d| {
        link_screen(d, &LinkInfo { code: "QFH7-FXRT", url: "matecrew.vercel.app/link", url_with_code: "https://matecrew.vercel.app/link?code=QFH7-FXRT", bluetooth: "matecrew-50E4 · 482913" })
    });
    all.add("linked", "Approved", |d| linked_screen(d, "Lausanne", "Terminal Lausanne"));
    all.add("connecting", "Joining the office Wi-Fi", |d| connecting_screen(d, "OWT-Office"));
    all.add("connected", "On the network", |d| connected_screen(d, "OWT-Office", "10.0.4.27"));
    all.add("badge", "A key was touched: badge now", |d| badge_screen(d, "Prendre"));
    let pick = PickInfo { name: "Alex", item: "Maté Classic", stock: 36, image: Some(&image), index: 0, count: 3 };
    all.add("pick", "Choose the item", |d| pick_screen(d, &pick));
    all.add("leave", "Nothing for me", |d| leave_screen(d, "Alex"));
    all.add("taken", "Confirmation, 10 s to cancel", |d| taken_screen(d, "Alex", "Maté Classic", Some(&image)));
    let labels = ["ven", "sam", "dim", "lun", "mar", "mer", "jeu"].map(String::from);
    let products = ["Maté Classic", "Maté Zero", "Maté Ginger"].map(String::from);
    let days = [[1, 0, 0], [0, 1, 0], [0, 0, 0], [1, 1, 1], [0, 0, 0], [2, 0, 1], [1, 0, 0]].map(|d| d.to_vec());
    let summary = SummaryInfo {
        name: "Alex Martin",
        today: 1,
        week: 4,
        month: 11,
        days: &days,
        products: &products,
        labels: &labels,
        cost: Some("CHF 12.40"),
    };
    all.add("summary", "My consumption: counts, the last 7 days, the month's cost", |d| summary_screen(d, &summary));
    all.add("update", "Installing a firmware update", |d| update_screen(d, "0.2.0", 50));
    all.add("unknown-badge", "Badge not assigned yet", |d| unknown_badge_screen(d, "04A1B2C3D4E5F6", None));
    let claim = "https://matecrew.vercel.app/badge?d=cmv1eex25001zieyucz0rillv&u=04A1B2C3D4E5F6&t=1791570300&s=1XA8_wdH3MGEW6rDCHsTew";
    all.add("claim-badge", "Badge not assigned yet, with a claim link", |d| unknown_badge_screen(d, "04A1B2C3D4E5F6", Some(claim)));
    all.add("error", "Wi-Fi not found", |d| error_screen(d, "Wi-Fi introuvable", "Le réseau « OWT-Office » ne répond pas."));
    all.add("about", "Both keys: version, network, battery", |d| flow_screen(d, &Screen::About));
    all.add("about-charging", "About, on USB while charging", |d| flow_screen(d, &Screen::About));
    all.0["about-charging"]["data"]["$device"] = device_info::decorate(json!({
        "firmware":{"version":"0.3.0","build":"2026-10-10 09:12 UTC","commit":"546a98a","slot":"ota_1"},
        "site":"matecrew.vercel.app",
        "device":{"id":"cmv1eex25001zieyucz0rillv","name":"Terminal Lausanne"},
        "chip":{"model":"ESP32-S3","id":"ACA704123456"},
        "wifi":{"rssi":null},
        "battery":{"millivolts":4100,"usb":true},
        "uptimeMinutes":2,
        "clock":"10:42"
    }));
    // The same screens in English, as an office with `locale: "en"` gets them.
    for (name, from) in [("stock-en", "stock"), ("setup-en", "setup"), ("pick-en", "pick"), ("summary-en", "summary"), ("about-en", "about")] {
        let mut preview = all.0[from].clone();
        preview["data"]["$device"]["locale"] = json!("en");
        preview["description"] = json!(format!("{} (English)", preview["description"].as_str().unwrap_or(from)));
        all.0.insert(name.into(), preview);
    }
    // The site names the days in the office's language.
    for (i, day) in ["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"].iter().enumerate() {
        all.0["summary-en"]["data"]["view"]["days"][i]["day"] = json!(day);
    }
    flow(&mut all.0);
    Value::Object(all.0)
}

/// What the studio shows next on a key or a badge, standing in for `core::flow` (no network there).
fn flow(previews: &mut Map<String, Value>) {
    let mut on = |names: &[&str], events: &[(&str, &str)]| {
        for name in names {
            let preview = previews.get_mut(*name).expect("known preview");
            for (event, next) in events {
                preview["on"][*event] = json!(next);
            }
        }
    };
    let home = ["stock", "stock-offline", "stock-0", "stock-1", "stock-2", "stock-4", "stock-5", "stock-6", "stock-9", "stock-20", "preparation"];
    on(&home, &[("left", "badge"), ("right", "summary")]);
    // While a preparation shows, the right key is "Servi": a runner's badge, then the site's count.
    on(&["preparation"], &[("right", "badge-serve")]);
    on(&["badge-serve"], &[("badge", "served"), ("left", "preparation"), ("right", "preparation")]);
    on(&["served"], &[("left", "stock"), ("right", "stock")]);
    on(&["badge"], &[("badge", "pick"), ("left", "stock"), ("right", "stock")]);
    on(&["pick"], &[("left", "leave"), ("right", "taken")]);
    on(&["leave"], &[("left", "pick"), ("right", "stock")]);
    on(&["taken", "summary", "unknown-badge", "claim-badge", "error"], &[("left", "stock"), ("right", "stock")]);
    on(&home, &[("badge", "unknown-badge")]);
    // Both keys, from any screen once the terminal runs: its about page; a key goes back.
    let running = ["badge", "pick", "leave", "taken", "summary", "unknown-badge", "claim-badge", "error", "badge-serve", "served"];
    on(&home, &[("both", "about")]);
    on(&running, &[("both", "about")]);
    on(&["about", "about-charging", "about-en"], &[("left", "stock"), ("right", "stock")]);
}

#[test]
fn committed_previews_match_the_screen_adapters() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../apps/mate/previews.json");
    // One preview per line: compact, and a change shows up as a one-line diff.
    let lines: Vec<String> = previews()
        .as_object()
        .unwrap()
        .iter()
        .map(|(name, preview)| format!("  {}: {}", Value::from(name.as_str()), preview))
        .collect();
    let expected = format!("{{\n{}\n}}\n", lines.join(",\n"));
    if std::env::var_os("UPDATE_PREVIEWS").is_some() {
        std::fs::write(path, &expected).unwrap();
    }
    let committed = std::fs::read_to_string(path).unwrap_or_default();
    assert!(
        committed == expected,
        "apps/mate/previews.json is stale: run `UPDATE_PREVIEWS=1 cargo test -p matecrew-ui`"
    );
}
