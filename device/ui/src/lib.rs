//! Terminal host adapter. All layouts are compiled from apps/mate (see device.config.ts).
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*};
use matecrew_core::{contract::decode_base64, flow::Screen};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
pub mod apps;
pub mod boot;
pub mod captive;
pub mod dashboard;
pub mod device_info;
pub mod form;
pub mod frame;
pub mod notifications;
pub mod picture;
#[cfg(test)]
mod previews;
mod screens;
mod status_icons;
pub use dashboard::{dashboard_screen, state_screen};
pub use device_engine as engine;
pub use engine::Theme;
use std::sync::atomic::{AtomicU8, Ordering};
static THEME: AtomicU8 = AtomicU8::new(0);
/// Host-selected theme for this terminal. Custom apps may use their own local theme hook.
pub fn set_theme(theme: Theme) {
    THEME.store(
        match theme {
            Theme::Flipper => 0,
            Theme::Macos => 1,
            Theme::Dark => 2,
            Theme::Paper => 3,
        },
        Ordering::Relaxed,
    );
}
static LOCALE: Mutex<String> = Mutex::new(String::new());
/// The office's locale (`fr`, `en`…), for the screens' translations; empty until the first sync.
pub fn set_locale(locale: &str) {
    *LOCALE.lock().expect("locale lock") = locale.chars().take(16).collect();
}
fn locale() -> String {
    LOCALE.lock().expect("locale lock").clone()
}
fn theme() -> Theme {
    match THEME.load(Ordering::Relaxed) {
        1 => Theme::Macos,
        2 => Theme::Dark,
        3 => Theme::Paper,
        _ => Theme::Flipper,
    }
}
pub use frame::Frame;
pub const WIDTH: u32 = 800;
pub const HEIGHT: u32 = 480;
pub const KEY_LEFT_X: i32 = 32;
pub const KEY_RIGHT_X: i32 = 168;

type CachedScreen = Option<(&'static str, engine::Scene)>;
fn screen_cache() -> &'static Mutex<CachedScreen> {
    static CACHE: OnceLock<Mutex<CachedScreen>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}
/// SDK apps own their scene; release the last built-in layout when switching away.
pub fn release_screen_cache() {
    *screen_cache().lock().expect("screen cache lock") = None;
}
/// Cache only the visible built-in screen. Decoding all screens exhausts an MCU's
/// internal heap with small allocations, even when framebuffers live in PSRAM.
pub(crate) fn render<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    name: &str,
    data: Value,
) -> Result<(), D::Error> {
    let mut cached = screen_cache().lock().expect("screen cache lock");
    if cached.as_ref().is_none_or(|(current, _)| *current != name) {
        // Free the old tree before allocating the next one.
        *cached = None;
        let (name, bytes) = screens::DEFINITIONS
            .iter()
            .find(|(key, _)| *key == name)
            .expect("built-in screen");
        let scene = engine::Scene::from_bytecode(bytes)
            .unwrap_or_else(|error| panic!("invalid compiled {name} screen: {error}"));
        *cached = Some((*name, scene));
    }
    let mut device = device_info::get();
    device["locale"] = json!(locale());
    let data = json!({"view":data,"$device":device});
    #[cfg(test)]
    previews::record(name, &data);
    let scene = &cached.as_ref().expect("loaded screen").1;
    scene.render_with_theme(d, &data, app_scale(scene), theme())?;
    notifications::render(d, theme())
}

/// Integer scale that fits an SDK app's viewport on the panel.
pub fn app_scale(scene: &engine::Scene) -> u32 {
    (WIDTH / scene.width).min(HEIGHT / scene.height).max(1)
}

/// Draw an SDK app, then the system notification layer unless one of the app's dialogs owns the screen.
/// Shared by the firmware and the virtual terminal so both composite overlays identically.
pub fn render_app<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    app: &engine::Runtime,
    scale: u32,
) -> Result<(), D::Error> {
    app.scene().render(d, app.data(), scale)?;
    if app.data()["$overlay"]["dialog"]["visible"] == true {
        return Ok(());
    }
    let theme = Theme::from_name(app.data()["local"]["theme"].as_str().unwrap_or("flipper"));
    notifications::render(d, theme)
}

fn message<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    screen: &str,
    title: &str,
    heading: &str,
    detail: &str,
    footer: &str,
) -> Result<(), D::Error> {
    render(
        d,
        screen,
        json!({"title":title,"heading":heading,"detail":detail,"footer":footer}),
    )
}
/// What the setup screen shows so a phone can join the setup access point.
pub struct SetupInfo<'a> {
    pub ap_ssid: &'a str,
    pub ap_password: &'a str,
    pub portal_url: &'a str,
    /// "matecrew-50E4 · 123456": the Bluetooth name and passkey, empty without Bluetooth.
    pub bluetooth: &'a str,
}

/// Shown while the terminal waits for an admin to approve its code on the site.
pub struct LinkInfo<'a> {
    /// "ABCD-2345", as the server formatted it.
    pub code: &'a str,
    /// Short address to type, without the scheme: "matecrew.vercel.app/link".
    pub url: &'a str,
    /// Address with the code, encoded in the QR.
    pub url_with_code: &'a str,
    /// As in [`SetupInfo`].
    pub bluetooth: &'a str,
}

/// Right side of the status bar.
#[derive(Clone, Copy)]
pub enum Status<'a> {
    /// "1/2", "2/2": where the person is in the setup.
    Step(&'a str),
    /// Wi-Fi signal (0 to 3 bars) and battery charge (0 to 100 %, if known).
    Device {
        wifi_bars: u8,
        battery: Option<u8>,
    },
    None,
}

pub struct PickInfo<'a> {
    pub name: &'a str,
    pub item: &'a str,
    pub stock: i64,
    /// 24 x 24, packed 1-bit, as `contract::Item::image` decodes; None draws a frame.
    pub image: Option<&'a [u8]>,
    pub index: u32,
    pub count: u32,
}

pub fn setup_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    info: &SetupInfo,
) -> Result<(), D::Error> {
    render(
        d,
        "setup",
        json!({"title":"Mise en service","ssid":info.ap_ssid,"password":info.ap_password,"portal":info.portal_url.trim_start_matches("http://"),"qr":wifi_qr_payload(info.ap_ssid,info.ap_password),"bluetooth":info.bluetooth}),
    )
}
pub fn link_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    info: &LinkInfo,
) -> Result<(), D::Error> {
    render(
        d,
        "link",
        json!({"title":"Mise en service","code":info.code,"url":info.url,"qr":info.url_with_code,"bluetooth":info.bluetooth}),
    )
}
pub fn linked_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    office: &str,
    name: &str,
) -> Result<(), D::Error> {
    render(
        d,
        "linked",
        json!({"title":"Mise en service","office":office,"name":name}),
    )
}
pub fn connecting_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    ssid: &str,
) -> Result<(), D::Error> {
    render(d, "connecting", json!({"title":"Mise en service","ssid":ssid}))
}
pub fn connected_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    ssid: &str,
    ip: &str,
) -> Result<(), D::Error> {
    render(
        d,
        "connected",
        json!({"title":"Mise en service","ssid":ssid,"ip":ip}),
    )
}
pub fn error_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    title: &str,
    detail: &str,
) -> Result<(), D::Error> {
    message(
        d,
        "error",
        "À vérifier",
        title,
        detail,
        "Le site donne accès aux réglages du terminal",
    )
}
pub fn badge_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    label: &str,
) -> Result<(), D::Error> {
    render(
        d,
        "badge",
        json!({"title":label,"left":"Annuler","right":"Annuler"}),
    )
}
pub fn pick_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    info: &PickInfo,
) -> Result<(), D::Error> {
    render(
        d,
        "pick",
        json!({"title":info.name,"status":format!("{}/{}",info.index.saturating_add(1),info.count),"index":info.index,"count":info.count,"item":info.item,"stock":info.stock,"image":info.image.unwrap_or(&[]),"picture":picture::pictures(info.image.unwrap_or(&[])).0,"left":"Suivant","right":"Prendre"}),
    )
}
pub fn leave_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    name: &str,
) -> Result<(), D::Error> {
    render(
        d,
        "leave",
        json!({"title":name,"left":"Suivant","right":"Quitter"}),
    )
}
pub fn taken_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    name: &str,
    item: &str,
    image: Option<&[u8]>,
) -> Result<(), D::Error> {
    render(
        d,
        "taken",
        json!({"name":name,"item":item,"image":image.unwrap_or(&[])}),
    )
}
/// What a person drank, from their badge as of the last sync: counts, the last days and the
/// month's cost.
pub struct SummaryInfo<'a> {
    pub name: &'a str,
    pub today: u32,
    pub week: u32,
    pub month: u32,
    /// Oldest first, named by `labels`: a count per `products` entry.
    pub days: &'a [Vec<u32>],
    pub products: &'a [String],
    pub labels: &'a [String],
    pub cost: Option<&'a str>,
}

pub fn summary_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    info: &SummaryInfo,
) -> Result<(), D::Error> {
    // One row per day, `p0`…`p3` per product: the chart's stacked bars.
    let days: Vec<Value> = info
        .days
        .iter()
        .enumerate()
        .map(|(i, counts)| {
            let mut row = json!({"day": info.labels.get(i).map_or("", String::as_str)});
            for (p, n) in counts.iter().take(4).enumerate() {
                row[format!("p{p}")] = json!(n);
            }
            row
        })
        .collect();
    // Two matés a day should not look like a peak: the scale starts at 4.
    let max = info.days.iter().map(|d| d.iter().sum::<u32>()).max().unwrap_or(0).max(4);
    render(
        d,
        "summary",
        json!({
            "name": info.name,
            "today": info.today,
            "week": info.week,
            "month": info.month,
            "days": days,
            "products": info.products.iter().take(4).collect::<Vec<_>>(),
            "max": max,
            "cost": info.cost,
        }),
    )
}
pub fn update_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    version: &str,
    percent: u8,
) -> Result<(), D::Error> {
    render(
        d,
        "update",
        json!({"version":version,"percent":percent.min(100)}),
    )
}
pub fn unknown_badge_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    uid: &str,
    url: Option<&str>,
) -> Result<(), D::Error> {
    match url {
        Some(url) => render(
            d,
            "claim",
            json!({"title":"Nouveau badge","uid":uid,"qr":url}),
        ),
        None => message(
            d,
            "error",
            "Nouveau badge",
            "Badge à attribuer",
            "Un admin le relie à ton compte dans Appareils.",
            &format!("Badge {uid}"),
        ),
    }
}
pub fn flow_screen<D>(d: &mut D, screen: &Screen) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    match screen {
        Screen::Main => Ok(()),
        Screen::Badge { key_label } => badge_screen(d, key_label),
        Screen::Pick {
            name,
            item,
            stock,
            image,
            index,
            count,
        } => {
            let image = decode_base64(image);
            let info = PickInfo {
                name,
                item,
                stock: *stock,
                image: image.as_deref(),
                index: *index,
                count: *count,
            };
            pick_screen(d, &info)
        }
        Screen::Leave { name } => leave_screen(d, name),
        Screen::Taken { name, item, image } => {
            taken_screen(d, name, item, decode_base64(image).as_deref())
        }
        Screen::Summary {
            name,
            today,
            week,
            month,
            days,
            products,
            labels,
            cost,
        } => summary_screen(
            d,
            &SummaryInfo {
                name,
                today: *today,
                week: *week,
                month: *month,
                days,
                products,
                labels,
                cost: cost.as_deref(),
            },
        ),
        Screen::UnknownBadge { uid, claim_url } => {
            unknown_badge_screen(d, uid, claim_url.as_deref())
        }
        Screen::NotReady => error_screen(
            d,
            "Pas encore prêt",
            "Le terminal attend sa première synchro avec le site.",
        ),
        Screen::NoItems => error_screen(
            d,
            "Rien à prendre",
            "Aucun article n'est actif sur le site.",
        ),
        Screen::About => about_screen(d),
        Screen::Served { name, count } => served_screen(d, name, *count),
    }
}

/// The preparation was served from the terminal: who, and how many orders the site closed.
pub fn served_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    name: &str,
    count: u32,
) -> Result<(), D::Error> {
    render(d, "served", json!({"name":name,"count":count}))
}

/// Both keys: the terminal's own page. Everything it shows is in `$device` (`device_info::set`).
pub fn about_screen<D: DrawTarget<Color = BinaryColor>>(d: &mut D) -> Result<(), D::Error> {
    render(d, "about", json!({}))
}

/// Joining payload understood by iOS and Android cameras.
pub fn wifi_qr_payload(ssid: &str, password: &str) -> String {
    fn escape(s: &str) -> String {
        s.chars()
            .flat_map(|c| match c {
                '\\' | ';' | ',' | ':' | '"' => vec!['\\', c],
                c => vec![c],
            })
            .collect()
    }
    format!("WIFI:T:WPA;S:{};P:{};;", escape(ssid), escape(password))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_terminal_screen_uses_valid_compiled_bytecode_at_multiple_scales() {
        assert!(!screens::DEFINITIONS.is_empty());
        for (name, bytes) in screens::DEFINITIONS {
            let scene = engine::Scene::from_bytecode(bytes).unwrap();
            for scale in [1, 2] {
                let mut frame =
                    engine::frame::Frame::new(scene.width * scale, scene.height * scale).unwrap();
                scene
                    .render(
                        &mut frame,
                        &json!({"view":{"title":"Test","heading":"Écran","detail":"API data"}}),
                        scale,
                    )
                    .unwrap();
                assert!(frame.bits.iter().any(|&b| b != 0), "empty {name}");
            }
        }
    }
}
