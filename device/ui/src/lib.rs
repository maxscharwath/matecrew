//! Screens of the matécrew terminal, drawn on any 800 x 480 black and white target.
//!
//! `BinaryColor::On` is ink. The same code runs on the device and in `device/sim`.

use embedded_graphics::{
    pixelcolor::BinaryColor,
    prelude::*,
    primitives::{PrimitiveStyle, Rectangle, Triangle},
};
use qrcodegen::{QrCode, QrCodeEcc};
use u8g2_fonts::{
    fonts,
    types::{FontColor, HorizontalAlignment, VerticalPosition},
    FontRenderer,
};

pub const WIDTH: u32 = 800;
pub const HEIGHT: u32 = 480;

/// Key centres on the panel, from the enclosure model.
pub const KEY_LEFT_X: i32 = 130;
pub const KEY_RIGHT_X: i32 = 670;

const MARGIN: i32 = 30;
const INK: BinaryColor = BinaryColor::On;
const PAPER: BinaryColor = BinaryColor::Off;

const TITLE: FontRenderer = FontRenderer::new::<fonts::u8g2_font_helvB24_tf>();
const BODY: FontRenderer = FontRenderer::new::<fonts::u8g2_font_helvR18_tf>();
const BODY_BOLD: FontRenderer = FontRenderer::new::<fonts::u8g2_font_helvB18_tf>();
const CODE: FontRenderer = FontRenderer::new::<fonts::u8g2_font_inb42_mf>();

pub mod form;

/// What the setup screen shows so a phone can join the setup access point.
pub struct SetupInfo<'a> {
    pub ap_ssid: &'a str,
    pub ap_password: &'a str,
    pub portal_url: &'a str,
}

pub fn test_screen<D>(d: &mut D) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    header(d, "matécrew")?;
    text(d, &BODY, "Banc d'essai : XIAO ESP32-S3 + écran 7,5\", en Rust", 140)?;
    action_labels(d, "Prendre un maté", "Rendre un maté")
}

pub fn setup_screen<D>(d: &mut D, info: &SetupInfo) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    header(d, "Configuration du Wi-Fi")?;

    let qr = wifi_qr_payload(info.ap_ssid, info.ap_password);
    qr_code(d, &qr, Point::new(MARGIN, 110), 330)?;

    let x = 400;
    let lines: [(&FontRenderer, &str, i32); 6] = [
        (&BODY_BOLD, "1. Scanne ce code", 140),
        (&BODY, "avec l'appareil photo du téléphone.", 172),
        (&BODY_BOLD, "2. Rejoins le réseau proposé.", 222),
        (&BODY_BOLD, "3. Sur la page qui s'ouvre,", 272),
        (&BODY, "choisis le Wi-Fi du bureau.", 304),
        (&BODY, "Page absente ? Ouvre :", 370),
    ];
    for (font, line, y) in lines {
        text_at(d, font, line, Point::new(x, y))?;
    }
    text_at(d, &BODY_BOLD, info.portal_url, Point::new(x, 402))?;

    let ap = format!("Réseau {}, mot de passe {}", info.ap_ssid, info.ap_password);
    text(d, &BODY, &ap, 465)
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

pub fn link_screen<D>(d: &mut D, info: &LinkInfo) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    header(d, "Lier l'appareil")?;
    qr_code(d, info.url_with_code, Point::new(MARGIN, 110), 330)?;

    let x = 400;
    text_at(d, &BODY_BOLD, "Scanne ce code avec", Point::new(x, 140))?;
    text_at(d, &BODY_BOLD, "un compte admin du bureau,", Point::new(x, 172))?;
    text_at(d, &BODY, "ou ouvre", Point::new(x, 222))?;
    text_at(d, &BODY_BOLD, info.url, Point::new(x, 254))?;
    text_at(d, &BODY, "et saisis le code :", Point::new(x, 286))?;
    text_at(d, &CODE, info.code, Point::new(x, 360))?;
    text(d, &BODY, "Le code change toutes les 10 minutes.", 465)
}

pub fn linked_screen<D>(d: &mut D, office: &str, name: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    header(d, "matécrew")?;
    text(d, &BODY_BOLD, &format!("Lié au bureau « {office} »"), 140)?;
    text(d, &BODY, &format!("Cet appareil s'appelle « {name} ».", ), 180)?;
    text(d, &BODY, "Ses touches se règlent sur le site, dans Admin > Appareils.", 220)
}

pub fn connecting_screen<D>(d: &mut D, ssid: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    header(d, "matécrew")?;
    text(d, &BODY, &format!("Connexion au Wi-Fi « {ssid} »…"), 140)
}

pub fn connected_screen<D>(d: &mut D, ssid: &str, ip: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    header(d, "matécrew")?;
    text(d, &BODY_BOLD, &format!("Connecté au Wi-Fi « {ssid} »"), 140)?;
    text(d, &BODY, &format!("Adresse IP : {ip}"), 180)?;
    action_labels(d, "Prendre un maté", "Rendre un maté")
}

pub fn error_screen<D>(d: &mut D, title: &str, detail: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    header(d, title)?;
    text(d, &BODY, detail, 140)
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

fn header<D>(d: &mut D, title: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    d.clear(PAPER)?;
    text(d, &TITLE, title, 60)?;
    fill(d, Rectangle::new(Point::new(MARGIN, 80), Size::new(WIDTH - 2 * MARGIN as u32, 3)))
}

fn action_labels<D>(d: &mut D, left: &str, right: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    fill(d, Rectangle::new(Point::new(MARGIN, 400), Size::new(WIDTH - 2 * MARGIN as u32, 2)))?;
    for (x, label) in [(KEY_LEFT_X, left), (KEY_RIGHT_X, right)] {
        render(&BODY_BOLD, d, label, Point::new(x, 440), HorizontalAlignment::Center)?;
        Triangle::new(Point::new(x - 8, 452), Point::new(x + 8, 452), Point::new(x, 462))
            .into_styled(PrimitiveStyle::with_fill(INK))
            .draw(d)?;
    }
    Ok(())
}

fn qr_code<D>(d: &mut D, payload: &str, origin: Point, max_size: u32) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let Ok(qr) = QrCode::encode_text(payload, QrCodeEcc::Medium) else {
        return Ok(());
    };
    let modules = qr.size();
    let scale = (max_size as i32 / modules).max(1);
    for y in 0..modules {
        for x in 0..modules {
            if qr.get_module(x, y) {
                let at = origin + Point::new(x * scale, y * scale);
                fill(d, Rectangle::new(at, Size::new(scale as u32, scale as u32)))?;
            }
        }
    }
    Ok(())
}

fn text<D>(d: &mut D, font: &FontRenderer, s: &str, baseline: i32) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    text_at(d, font, s, Point::new(MARGIN, baseline))
}

fn text_at<D>(d: &mut D, font: &FontRenderer, s: &str, at: Point) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    render(font, d, s, at, HorizontalAlignment::Left)
}

fn render<D>(
    font: &FontRenderer,
    d: &mut D,
    s: &str,
    at: Point,
    align: HorizontalAlignment,
) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    match font.render_aligned(s, at, VerticalPosition::Baseline, align, FontColor::Transparent(INK), d) {
        Ok(_) => Ok(()),
        Err(u8g2_fonts::Error::DisplayError(e)) => Err(e),
        // A missing glyph or colour mode must not stop the screen from drawing.
        Err(_) => Ok(()),
    }
}

fn fill<D>(d: &mut D, rect: Rectangle) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    rect.into_styled(PrimitiveStyle::with_fill(INK)).draw(d)
}
