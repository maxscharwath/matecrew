//! The maté app's previews, taken from the real screen adapters so `dui render` and `dui test`
//! draw exactly the data the firmware passes. Writes `apps/mate/previews.json` when
//! `UPDATE_PREVIEWS=1`, and fails when the committed file differs.
use crate::*;
use matecrew_core::{
    contract::{decode_base64, DeviceScreen},
    flow::{Cause, Failure, Task},
};
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
        "memory":{
            "ram":{"used":251904,"total":331776},
            "psram":{"used":471040,"total":8388608},
            "firmware":{"used":2873728,"total":3670016},
            "storage":{"used":41984,"total":282240}
        },
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
    let picture = decode_base64(&dashboard.items[0].picture).unwrap();
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
    let drawn = |i: usize| dashboard.items[i % dashboard.items.len()].picture.clone();
    dashboard.preparation = Some(serde_json::from_value(json!({
        "title":"À préparer · Après-midi","total":"9 à préparer","sessionId":"s1","serveLabel":"Servi",
        "items":[
            {"name":"Maté Classic","count":5,"names":"Alex, Sam, Chris, Jo, Max","picture":drawn(0)},
            {"name":"Maté Zero","count":3,"names":"Pat, Robin, Mika","picture":drawn(1)},
            {"name":"Maté Ginger","count":1,"names":"Lou","picture":drawn(2)}
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
    let pick = PickInfo { name: "Alex", item: "Maté Classic", stock: 36, picture: &picture, index: 0, count: 3 };
    all.add("pick", "Choose the item", |d| pick_screen(d, &pick));
    all.add("leave", "Nothing for me", |d| leave_screen(d, "Alex"));
    all.add("taken", "Confirmation, 10 s to cancel", |d| taken_screen(d, "Alex", "Maté Classic"));
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
    // "Mon compte": the right key, a badge, then the site's live answer. Its left key lists the
    // purchases, four to a page, the way back to the account last; the right key held goes
    // straight to them.
    let bought = |item: &str, when: &str, price: Option<&str>, i: usize| PurchaseRow {
        item: item.into(),
        when: when.into(),
        price: price.map(String::from),
        picture: drawn(i),
    };
    let first = vec![
        bought("Maté Classic", "Aujourd'hui · 14:05", Some("CHF 1.85"), 0),
        bought("Maté Zero", "Aujourd'hui · 09:12", Some("CHF 2.10"), 1),
        bought("Maté Ginger", "Hier · 16:40", Some("CHF 2.35"), 2),
        bought("Maté Classic", "08.10 · 11:02", None, 0),
    ];
    let last = vec![bought("Maté Zero", "07.10 · 15:20", Some("CHF 2.10"), 1), bought("Maté Classic", "06.10 · 10:48", Some("CHF 1.85"), 0)];
    let labels = ["ven", "sam", "dim", "lun", "mar", "mer", "jeu"].map(String::from);
    let products = ["Maté Classic", "Maté Zero", "Maté Ginger"].map(String::from);
    let days = [[1, 0, 0], [0, 1, 0], [0, 0, 0], [1, 1, 1], [0, 0, 0], [2, 0, 1], [1, 0, 0]].map(|d| d.to_vec());
    let account = Screen::Account {
        name: "Alex Martin".into(),
        today: 1,
        week: 4,
        month: 11,
        cost: Some("CHF 12.40".into()),
        days: days.to_vec(),
        products: products.to_vec(),
        labels: labels.to_vec(),
        recent: first[..matecrew_core::flow::ACCOUNT_PURCHASES].to_vec(),
    };
    let purchases = |rows: &[PurchaseRow], selected, back, page, confirm| Screen::Purchases {
        name: "Alex Martin".into(),
        rows: rows.to_vec(),
        selected,
        back,
        page,
        pages: 2,
        confirm,
    };
    let failed = |task, failure| Screen::Failed { task, failure };
    all.add("account-badge", "Right key: the badge whose account to show", |d| {
        flow_screen(d, &Screen::AccountBadge { purchases: false })
    });
    all.add("account-loading", "Asking the site for the account", |d| {
        flow_screen(d, &Screen::AccountLoading { name: "Alex".into(), cancelling: false })
    });
    all.add("account", "My account: counts, the last 7 days, the month's cost, the latest purchases", |d| flow_screen(d, &account));
    all.add("account-new", "A new member: nothing drunk or bought yet, no price known", |d| {
        flow_screen(d, &Screen::Account {
            name: "Sam".into(),
            today: 0,
            week: 0,
            month: 0,
            cost: None,
            days: vec![Vec::new(); 7],
            products: Vec::new(),
            labels: labels.to_vec(),
            recent: Vec::new(),
        })
    });
    all.add("account-offline", "No Wi-Fi: the account lives on the site", |d| {
        flow_screen(d, &failed(Task::Account, Failure::Offline { cause: Cause::Wifi }))
    });
    all.add("account-timeout", "The site did not answer in time", |d| {
        flow_screen(d, &failed(Task::Account, Failure::Offline { cause: Cause::Timeout }))
    });
    all.add("account-tls", "The secure connection failed", |d| {
        flow_screen(d, &failed(Task::Account, Failure::Offline { cause: Cause::Tls }))
    });
    all.add("account-site-error", "The site answered with an error", |d| {
        flow_screen(d, &failed(Task::Account, Failure::Site { status: 503 }))
    });
    all.add("account-unreadable", "The site answered something this terminal cannot read", |d| {
        flow_screen(d, &failed(Task::Account, Failure::Unreadable))
    });
    all.add("account-unknown-badge", "The site knows nobody with this badge", |d| {
        flow_screen(d, &failed(Task::Purchases, Failure::UnknownBadge))
    });
    all.add("purchases-badge", "Right key held: the badge whose purchases to list", |d| {
        flow_screen(d, &Screen::AccountBadge { purchases: true })
    });
    all.add("purchases-from-account", "My purchases, from the account's left key", |d| {
        flow_screen(d, &purchases(&first, 0, false, 0, false))
    });
    all.add("purchases", "My purchases: a page of four, the left key moves", |d| {
        flow_screen(d, &purchases(&first, 1, false, 0, false))
    });
    all.add("purchases-last", "The last page, then the way back to the account", |d| flow_screen(d, &purchases(&last, 2, true, 1, false)));
    all.add("purchases-confirm", "Cancel this purchase? The right key again", |d| {
        flow_screen(d, &purchases(&first, 1, false, 0, true))
    });
    all.add("purchases-cancelling", "The site cancels the purchase", |d| {
        flow_screen(d, &Screen::AccountLoading { name: "Alex Martin".into(), cancelling: true })
    });
    all.add("purchases-cancel-failed", "The cancellation did not reach the site", |d| {
        flow_screen(d, &failed(Task::Cancel, Failure::Site { status: 500 }))
    });
    all.add("purchases-empty", "Nothing bought lately", |d| {
        flow_screen(d, &Screen::Purchases { name: "Sam".into(), rows: Vec::new(), selected: 0, back: true, page: 0, pages: 1, confirm: false })
    });
    // The same screens in English, as an office with `locale: "en"` gets them.
    for (name, from) in [
        ("stock-en", "stock"),
        ("setup-en", "setup"),
        ("pick-en", "pick"),
        ("account-en", "account"),
        ("account-site-error-en", "account-site-error"),
        ("about-en", "about"),
        ("purchases-en", "purchases"),
    ] {
        let mut preview = all.0[from].clone();
        preview["data"]["$device"]["locale"] = json!("en");
        preview["description"] = json!(format!("{} (English)", preview["description"].as_str().unwrap_or(from)));
        all.0.insert(name.into(), preview);
    }
    // The site names the days in the office's language.
    for (i, day) in ["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"].iter().enumerate() {
        all.0["account-en"]["data"]["view"]["days"][i]["day"] = json!(day);
    }
    // The site writes the dates in the office's language.
    for (i, when) in ["Today · 14:05", "Today · 09:12", "Yesterday · 16:40", "08.10 · 11:02"].iter().enumerate() {
        all.0["purchases-en"]["data"]["view"]["rows"][i]["when"] = json!(when);
        if i < matecrew_core::flow::ACCOUNT_PURCHASES {
            all.0["account-en"]["data"]["view"]["recent"][i]["when"] = json!(when);
        }
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
    on(&home, &[("left", "badge"), ("right", "account-badge"), ("rightLong", "purchases-badge")]);
    // The loading screens stand for the site's answer: a key shows it.
    on(&["account-badge"], &[("badge", "account-loading"), ("left", "stock"), ("right", "stock")]);
    on(&["account-loading"], &[("left", "account"), ("right", "account")]);
    on(&["account", "account-new", "account-en"], &[("left", "purchases-from-account"), ("right", "stock")]);
    on(&["purchases-badge"], &[("badge", "purchases-from-account"), ("left", "stock"), ("right", "stock")]);
    on(&["purchases-from-account"], &[("left", "purchases"), ("right", "purchases-confirm")]);
    on(&["purchases", "purchases-en"], &[("left", "purchases-last"), ("right", "purchases-confirm")]);
    on(&["purchases-confirm"], &[("left", "purchases"), ("right", "purchases-cancelling")]);
    on(&["purchases-cancelling"], &[("left", "purchases"), ("right", "purchases")]);
    on(&["purchases-last"], &[("left", "purchases-from-account"), ("right", "account")]);
    on(&["purchases-empty"], &[("left", "purchases-empty"), ("right", "account-new")]);
    // A failure: the left key tries again, the right one closes; an unknown badge only closes.
    let failures = ["account-offline", "account-timeout", "account-tls", "account-site-error", "account-site-error-en", "account-unreadable", "purchases-cancel-failed"];
    on(&failures, &[("left", "account-loading"), ("right", "stock")]);
    on(&["account-unknown-badge"], &[("left", "stock"), ("right", "stock")]);
    // While a preparation shows, the right key is "Servi": a runner's badge, then the site's count.
    on(&["preparation"], &[("right", "badge-serve")]);
    on(&["badge-serve"], &[("badge", "served"), ("left", "preparation"), ("right", "preparation")]);
    on(&["served"], &[("left", "stock"), ("right", "stock")]);
    on(&["badge"], &[("badge", "pick"), ("left", "stock"), ("right", "stock")]);
    on(&["pick"], &[("left", "leave"), ("right", "taken")]);
    on(&["leave"], &[("left", "pick"), ("right", "stock")]);
    on(&["taken", "unknown-badge", "claim-badge", "error"], &[("left", "stock"), ("right", "stock")]);
    on(&home, &[("badge", "unknown-badge")]);
    // Both keys, from any screen once the terminal runs: its about page; a key goes back.
    let running = ["badge", "pick", "leave", "taken", "unknown-badge", "claim-badge", "error", "badge-serve", "served"];
    on(&home, &[("both", "about")]);
    on(&running, &[("both", "about")]);
    let account = ["account-badge", "account-loading", "account", "account-new", "purchases-badge", "purchases-from-account", "purchases", "purchases-last", "purchases-confirm", "purchases-cancelling", "purchases-empty"];
    on(&account, &[("both", "about")]);
    on(&failures, &[("both", "about")]);
    on(&["account-unknown-badge"], &[("both", "about")]);
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
