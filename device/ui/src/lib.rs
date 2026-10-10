//! Terminal host adapter. All layouts are compiled from screens/terminal.tsx.
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
        },
        Ordering::Relaxed,
    );
}
fn theme() -> Theme {
    match THEME.load(Ordering::Relaxed) {
        1 => Theme::Macos,
        2 => Theme::Dark,
        _ => Theme::Flipper,
    }
}
pub use frame::Frame;
pub const WIDTH: u32 = 800;
pub const HEIGHT: u32 = 480;
pub const SCALE: u32 = 2;
pub const W: i32 = 400;
pub const H: i32 = 240;
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
    cached
        .as_ref()
        .expect("loaded screen")
        .1
        .render_with_theme(
            d,
            &json!({"view":data,"$device":device_info::get()}),
            SCALE,
            theme(),
        )?;
    notifications::render(d, theme())
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
}

/// Shown while the terminal waits for an admin to approve its code on the site.
pub struct LinkInfo<'a> {
    /// "ABCD-2345", as the server formatted it.
    pub code: &'a str,
    /// Short address to type, without the scheme: "matecrew.vercel.app/link".
    pub url: &'a str,
    /// Address with the code, encoded in the QR.
    pub url_with_code: &'a str,
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

pub fn test_screen<D: DrawTarget<Color = BinaryColor>>(d: &mut D) -> Result<(), D::Error> {
    message(
        d,
        "test",
        "matécrew",
        "Banc d'essai",
        "Rust · TSX · écran 7,5 pouces",
        "Rendu entièrement sur le terminal",
    )
}
pub fn setup_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    info: &SetupInfo,
) -> Result<(), D::Error> {
    render(
        d,
        "setup",
        json!({"title":"Wi-Fi","status":"1/2","heading":"SCANNE LE QR","detail":"Scanne pour ouvrir les réglages.","extra":format!("{} · {}",info.ap_ssid,info.ap_password),"qr":wifi_qr_payload(info.ap_ssid,info.ap_password),"footer":format!("Sans QR : {}",info.portal_url.trim_start_matches("http://"))}),
    )
}
pub fn link_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    info: &LinkInfo,
) -> Result<(), D::Error> {
    render(
        d,
        "link",
        json!({"title":"Liaison","status":"2/2","heading":"CODE À VALIDER","detail":info.code,"extra":"Un admin choisit le bureau.","qr":info.url_with_code,"footer":format!("Sans QR : {}",info.url)}),
    )
}
pub fn linked_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    office: &str,
    name: &str,
) -> Result<(), D::Error> {
    message(
        d,
        "linked",
        "Terminal lié",
        "Tout est prêt",
        &format!("{office} · {name}"),
        "Une touche, puis ton badge : c'est parti",
    )
}
pub fn connecting_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    ssid: &str,
) -> Result<(), D::Error> {
    message(
        d,
        "connecting",
        "Connexion",
        "Connexion Wi-Fi",
        ssid,
        "Quelques secondes pour retrouver le réseau",
    )
}
pub fn connected_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    ssid: &str,
    ip: &str,
) -> Result<(), D::Error> {
    message(
        d,
        "connected",
        "Wi-Fi connecté",
        "Réseau trouvé",
        &format!("{ssid} · {ip}"),
        "Le terminal contacte ton site matécrew",
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
        json!({"title":info.name,"status":format!("{}/{}",info.index.saturating_add(1),info.count),"item":info.item,"stock":info.stock,"stockHint":if info.index.saturating_add(1)==info.count {"Suivant : quitter"}else{"en stock"},"image":info.image.unwrap_or(&[]),"left":"Suivant","right":"Prendre"}),
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
        json!({"title":"C'est pris","status":"OK","heading":format!("Bonne pause {name} !"),"item":item,"image":image.unwrap_or(&[]),"footer":"Retour au stock dans un instant"}),
    )
}
pub fn summary_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    name: &str,
    today: u32,
    week: u32,
    month: u32,
) -> Result<(), D::Error> {
    render(
        d,
        "summary",
        json!({"title":"Ma conso","name":name,"today":today,"week":week,"month":month,"footer":"Le détail de ta consommation est sur le site"}),
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
        json!({"title":"Mise à jour","heading":format!("Installation · {version}"),"percent":percent.min(100),"detail":format!("{} %",percent.min(100)),"footer":"Garde le terminal alimenté jusqu'au redémarrage"}),
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
            json!({"title":"Nouveau badge","heading":"TON BADGE","detail":"Scanne pour le relier à ton compte.","extra":"Puis repasse ton badge.","qr":url,"footer":format!("Badge {uid}")}),
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
        } => summary_screen(d, name, *today, *week, *month),
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
    }
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
