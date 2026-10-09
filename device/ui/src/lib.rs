//! Screens of the matécrew terminal: 1-bit pixel art on a 200 x 120 canvas,
//! scaled x4 to the 800 x 480 panel.
//!
//! `BinaryColor::On` is ink. The same code runs on the device and in `device/sim`.

use embedded_graphics::{
    pixelcolor::BinaryColor,
    prelude::*,
    primitives::{CornerRadii, PrimitiveStyle, Rectangle, RoundedRectangle},
};
use matecrew_core::{
    contract::{decode_base64, ITEM_IMAGE_SIZE},
    flow::Screen,
};
use qrcodegen::{QrCode, QrCodeEcc};
use u8g2_fonts::{
    fonts,
    types::{FontColor, HorizontalAlignment, VerticalPosition},
    FontRenderer,
};

pub mod captive;
pub mod frame;
pub mod form;
mod icons;
mod pixelated;

pub use frame::Frame;
pub use pixelated::Pixelated;

/// Panel size in physical pixels.
pub const WIDTH: u32 = 800;
pub const HEIGHT: u32 = 480;
/// Every logical pixel is SCALE x SCALE physical pixels.
pub const SCALE: u32 = 4;
/// Canvas size in logical pixels.
pub const W: i32 = (WIDTH / SCALE) as i32;
pub const H: i32 = (HEIGHT / SCALE) as i32;

/// Key centres on the canvas, from the enclosure model (130 and 670 physical px).
pub const KEY_LEFT_X: i32 = 32;
pub const KEY_RIGHT_X: i32 = 168;

const INK: BinaryColor = BinaryColor::On;
const PAPER: BinaryColor = BinaryColor::Off;

const PRIMARY: FontRenderer = FontRenderer::new::<fonts::u8g2_font_helvB08_tf>();
const SECONDARY: FontRenderer = FontRenderer::new::<fonts::u8g2_font_helvR08_tf>();
const MONO: FontRenderer = FontRenderer::new::<fonts::u8g2_font_profont10_tf>();
const BIG_MONO: FontRenderer = FontRenderer::new::<fonts::u8g2_font_profont22_tf>();
const BIG: FontRenderer = FontRenderer::new::<fonts::u8g2_font_helvB14_tf>();

const STATUS_H: i32 = 12;
const CONTENT_TOP: i32 = 17;

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
    Device { wifi_bars: u8, battery: Option<u8> },
    None,
}

pub fn test_screen<D>(d: &mut D) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, "matécrew", Status::Device { wifi_bars: 3, battery: Some(80) })?;
    title_bar(px, Point::new(4, CONTENT_TOP), W - 8, "BANC D'ESSAI")?;
    text(px, &SECONDARY, "XIAO ESP32-S3, écran 7,5\", Rust.", Point::new(6, 40))?;
    text(px, &SECONDARY, "Les écrans sont du pixel art x4.", Point::new(6, 52))?;
    key_hints(px, "Prendre", "Rendre")
}

pub fn setup_screen<D>(d: &mut D, info: &SetupInfo) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, "Wi-Fi", Status::Step("1/2"))?;
    let qr = qr_panel(px, &wifi_qr_payload(info.ap_ssid, info.ap_password), Point::new(3, CONTENT_TOP))?;

    let x = qr.top_left.x + qr.size.width as i32 + 6;
    let width = W - x - 3;
    title_bar(px, Point::new(x, CONTENT_TOP), width, "SCANNE LE QR")?;
    let y = paragraph(px, &SECONDARY, "Le téléphone rejoint le terminal et la page des réglages s'ouvre.", x + 1, CONTENT_TOP + 24, width - 2)?;
    text(px, &MONO, info.ap_ssid, Point::new(x + 1, y + 6))?;
    text(px, &MONO, info.ap_password, Point::new(x + 1, y + 16))?;

    footer(px, &format!("Sinon, ouvre {}", info.portal_url.trim_start_matches("http://")))
}

pub fn link_screen<D>(d: &mut D, info: &LinkInfo) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, "Liaison", Status::Step("2/2"))?;
    let qr = qr_panel(px, info.url_with_code, Point::new(3, CONTENT_TOP))?;

    let x = qr.top_left.x + qr.size.width as i32 + 6;
    let width = W - x - 3;
    title_bar(px, Point::new(x, CONTENT_TOP), width, "CODE DE LIAISON")?;
    centered(px, &BIG_MONO, info.code, x + width / 2, CONTENT_TOP + 36)?;

    let y = paragraph(px, &SECONDARY, "Scanne avec un compte admin, ou ouvre :", x + 1, CONTENT_TOP + 52, width - 2)?;
    text(px, &MONO, info.url, Point::new(x + 1, y + 1))?;

    footer(px, "Nouveau code toutes les 10 minutes")
}

pub fn linked_screen<D>(d: &mut D, office: &str, name: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, "matécrew", Status::Step("OK"))?;
    icons::CHECK.draw(px, Point::new(W / 2 - icons::CHECK.width() / 2, CONTENT_TOP + 6))?;
    centered(px, &PRIMARY, &format!("Lié au bureau {office}"), W / 2, CONTENT_TOP + 42)?;
    centered(px, &SECONDARY, name, W / 2, CONTENT_TOP + 54)?;
    footer(px, "Touches et badges : Admin > Appareils")
}

pub fn connecting_screen<D>(d: &mut D, ssid: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, "matécrew", Status::None)?;
    icons::WIFI_BIG.draw(px, Point::new(W / 2 - icons::WIFI_BIG.width() / 2, CONTENT_TOP + 8))?;
    centered(px, &PRIMARY, "Connexion au Wi-Fi", W / 2, CONTENT_TOP + 44)?;
    centered(px, &SECONDARY, ssid, W / 2, CONTENT_TOP + 56)
}

pub fn connected_screen<D>(d: &mut D, ssid: &str, ip: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, "matécrew", Status::Device { wifi_bars: 3, battery: None })?;
    title_bar(px, Point::new(4, CONTENT_TOP), W - 8, "CONNECTÉ")?;
    text(px, &SECONDARY, &format!("Wi-Fi {ssid}"), Point::new(6, 40))?;
    text(px, &MONO, ip, Point::new(6, 52))?;
    footer(px, "Contact du site pour obtenir un code de liaison…")
}

pub fn error_screen<D>(d: &mut D, title: &str, detail: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, "matécrew", Status::None)?;
    icons::WARNING.draw(px, Point::new(W / 2 - icons::WARNING.width() / 2, CONTENT_TOP + 4))?;
    centered(px, &PRIMARY, title, W / 2, CONTENT_TOP + 34)?;
    for (i, line) in wrap(&SECONDARY, detail, W - 48).iter().enumerate() {
        centered(px, &SECONDARY, line, W / 2, CONTENT_TOP + 48 + 10 * i as i32)?;
    }
    Ok(())
}

/// After a key press: the terminal waits for a badge on the reader, under the
/// middle of the screen.
pub fn badge_screen<D>(d: &mut D, key_label: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, key_label, Status::None)?;
    icons::BADGE.draw(px, Point::new(W / 2 - icons::BADGE.width() / 2, CONTENT_TOP + 8))?;
    centered(px, &PRIMARY, "Pose ton badge", W / 2, CONTENT_TOP + 50)?;
    centered(px, &SECONDARY, "Une touche pour annuler", W / 2, CONTENT_TOP + 62)?;
    tab(px, W / 2, "BADGE")
}

/// What the picker shows: one item at a time, the left key for the next one,
/// the right key to take it.
pub struct PickInfo<'a> {
    pub name: &'a str,
    pub item: &'a str,
    pub stock: i64,
    /// 24 x 24, packed 1-bit, as `contract::Item::image` decodes; None draws a frame.
    pub image: Option<&'a [u8]>,
    pub index: u32,
    pub count: u32,
}

pub fn pick_screen<D>(d: &mut D, info: &PickInfo) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, info.name, Status::None)?;
    let side = ITEM_IMAGE * 2;
    picture(px, info.image, Point::new(12, CONTENT_TOP + 4), 2)?;
    let x = 12 + side + 12;
    let width = W - x - 6;
    let font = if text_width(&BIG, info.item) <= width { &BIG } else { &PRIMARY };
    let mut baseline = CONTENT_TOP + 18;
    for line in wrap(font, info.item, width).iter().take(2) {
        text(px, font, line, Point::new(x, baseline))?;
        baseline += 16;
    }
    text(px, &SECONDARY, &format!("{} en stock", info.stock), Point::new(x, baseline + 2))?;
    // Where the person is in the list: one dot per item, the current one filled.
    for i in 0..info.count.min(12) as i32 {
        let dot = Rectangle::new(Point::new(x + i * 7, baseline + 10), Size::new(4, 4));
        let style = if i as u32 == info.index { PrimitiveStyle::with_fill(INK) } else { PrimitiveStyle::with_stroke(INK, 1) };
        dot.into_styled(style).draw(px)?;
    }
    if info.index + 1 == info.count {
        text(px, &SECONDARY, "Autre : ne rien prendre", Point::new(x, baseline + 26))?;
    }
    key_hints(px, "Autre", "Prendre")
}

/// The stop after the last item: leave without taking anything.
pub fn leave_screen<D>(d: &mut D, name: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, name, Status::None)?;
    centered(px, &BIG, "Ne rien prendre", W / 2, CONTENT_TOP + 34)?;
    centered(px, &SECONDARY, "Quitter revient à l'écran du stock.", W / 2, CONTENT_TOP + 50)?;
    key_hints(px, "Autre", "Quitter")
}

/// The take is queued: what was taken, for whom.
pub fn taken_screen<D>(d: &mut D, name: &str, item: &str, image: Option<&[u8]>) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, "matécrew", Status::None)?;
    let side = ITEM_IMAGE * 2;
    picture(px, image, Point::new(W / 2 - side / 2, CONTENT_TOP + 2), 2)?;
    icons::CHECK.draw(px, Point::new(W / 2 + side / 2 + 4, CONTENT_TOP + 2))?;
    centered(px, &PRIMARY, &format!("Bonne pause {name} !"), W / 2, CONTENT_TOP + side + 16)?;
    centered(px, &SECONDARY, item, W / 2, CONTENT_TOP + side + 28)
}

/// What the person drank: today, this week, this month.
pub fn summary_screen<D>(d: &mut D, name: &str, today: u32, week: u32, month: u32) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, "Ma conso", Status::None)?;
    centered(px, &PRIMARY, name, W / 2, CONTENT_TOP + 12)?;
    let columns = [(today, "aujourd'hui"), (week, "semaine"), (month, "mois")];
    for (i, (count, label)) in columns.iter().enumerate() {
        let x = W / 6 + i as i32 * W / 3;
        let card = Rectangle::new(Point::new(x - 30, CONTENT_TOP + 20), Size::new(60, 48));
        RoundedRectangle::new(card, CornerRadii::new(Size::new(3, 3)))
            .into_styled(PrimitiveStyle::with_stroke(INK, 1))
            .draw(px)?;
        centered(px, &BIG_MONO, &count.to_string(), x, CONTENT_TOP + 46)?;
        centered(px, &SECONDARY, label, x, CONTENT_TOP + 60)?;
    }
    footer(px, "Le détail est sur le site")
}

/// An update over the network: which version and how far. Drawn at a few
/// steps only, each a partial refresh of the bar.
pub fn update_screen<D>(d: &mut D, version: &str, percent: u8) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, "Mise à jour", Status::None)?;
    centered(px, &PRIMARY, &format!("Version {version}"), W / 2, CONTENT_TOP + 20)?;
    let bar = Rectangle::new(Point::new(30, CONTENT_TOP + 32), Size::new((W - 60) as u32, 12));
    RoundedRectangle::new(bar, CornerRadii::new(Size::new(3, 3)))
        .into_styled(PrimitiveStyle::with_stroke(INK, 1))
        .draw(px)?;
    let filled = (W - 64) * i32::from(percent.min(100)) / 100;
    if filled > 0 {
        Rectangle::new(Point::new(32, CONTENT_TOP + 34), Size::new(filled as u32, 8))
            .into_styled(PrimitiveStyle::with_fill(INK))
            .draw(px)?;
    }
    centered(px, &MONO, &format!("{percent} %"), W / 2, CONTENT_TOP + 58)?;
    footer(px, "Le terminal redémarre tout seul à la fin")
}

/// The badge is not assigned to anyone yet. The terminal reports it to the
/// site, where an admin can give it to its owner.
pub fn unknown_badge_screen<D>(d: &mut D, uid: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    frame(px, "matécrew", Status::None)?;
    icons::WARNING.draw(px, Point::new(W / 2 - icons::WARNING.width() / 2, CONTENT_TOP + 4))?;
    centered(px, &PRIMARY, "Badge inconnu", W / 2, CONTENT_TOP + 34)?;
    for (i, line) in wrap(&SECONDARY, "Un admin peut l'attribuer sur le site, dans Admin > Appareils.", W - 40).iter().enumerate() {
        centered(px, &SECONDARY, line, W / 2, CONTENT_TOP + 48 + 10 * i as i32)?;
    }
    footer(px, uid)
}

/// Over the main screen while the site does not answer: a black band in
/// place of the status bar. Takes still work; they wait in the queue.
pub fn offline_banner<D>(d: &mut D) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let px = &mut Pixelated::new(d, SCALE);
    Rectangle::new(Point::zero(), Size::new(W as u32, (STATUS_H + 1) as u32))
        .into_styled(PrimitiveStyle::with_fill(INK))
        .draw(px)?;
    title_bar(px, Point::new(0, 0), W, "Site injoignable · les prises sont gardées")
}

/// Draws a screen of the take flow. `Screen::Main` draws nothing: it is the
/// site's bitmap, which the runtime keeps.
pub fn flow_screen<D>(d: &mut D, screen: &Screen) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    match screen {
        Screen::Main => Ok(()),
        Screen::Badge { key_label } => badge_screen(d, key_label),
        Screen::Pick { name, item, stock, image, index, count } => {
            let image = decode_base64(image);
            let info = PickInfo { name, item, stock: *stock, image: image.as_deref(), index: *index, count: *count };
            pick_screen(d, &info)
        }
        Screen::Leave { name } => leave_screen(d, name),
        Screen::Taken { name, item, image } => taken_screen(d, name, item, decode_base64(image).as_deref()),
        Screen::Summary { name, today, week, month } => summary_screen(d, name, *today, *week, *month),
        Screen::UnknownBadge { uid } => unknown_badge_screen(d, uid),
        Screen::NotReady => error_screen(d, "Pas encore prêt", "Le terminal attend sa première synchro avec le site."),
        Screen::NoItems => error_screen(d, "Rien à prendre", "Aucun article n'est actif sur le site."),
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

/// Paper, status bar with a title on the left, and a dotted rule under it.
fn frame<D>(px: &mut D, title: &str, status: Status) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    px.clear(PAPER)?;
    text(px, &PRIMARY, title, Point::new(3, 9))?;
    match status {
        Status::Step(step) => {
            render(&MONO, px, step, Point::new(W - 3, 9), HorizontalAlignment::Right)?;
        }
        Status::Device { wifi_bars, battery } => {
            let mut x = W - 3;
            if let Some(charge) = battery {
                x -= icons::battery_width();
                icons::draw_battery(px, Point::new(x, 2), charge)?;
                x -= 4;
            }
            x -= icons::wifi_width();
            icons::draw_wifi(px, Point::new(x, 1), wifi_bars)?;
        }
        Status::None => {}
    }
    for x in (0..W).step_by(2) {
        Pixel(Point::new(x, STATUS_H), INK).draw(px)?;
    }
    Ok(())
}

/// Black bar with white capitals, the way a selected item looks.
fn title_bar<D>(px: &mut D, at: Point, width: i32, label: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    RoundedRectangle::new(
        Rectangle::new(at, Size::new(width as u32, 12)),
        CornerRadii::new(Size::new(2, 2)),
    )
    .into_styled(PrimitiveStyle::with_fill(INK))
    .draw(px)?;
    let color = FontColor::Transparent(PAPER);
    match PRIMARY.render_aligned(label, at + Point::new(width / 2, 9), VerticalPosition::Baseline, HorizontalAlignment::Center, color, px) {
        Err(u8g2_fonts::Error::DisplayError(e)) => Err(e),
        _ => Ok(()),
    }
}

/// QR inside a rounded frame, returns the frame. The modules are drawn at the
/// panel's own resolution, 6 px (about 1.2 mm) each: small enough to look
/// neat, large enough for a phone held a hand away.
fn qr_panel<D>(px: &mut Pixelated<'_, D>, payload: &str, at: Point) -> Result<Rectangle, D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    const MODULE: i32 = 6;
    const PADDING: i32 = 3;
    let Ok(qr) = QrCode::encode_text(payload, QrCodeEcc::Low) else {
        return Ok(Rectangle::new(at, Size::zero()));
    };
    let scale = px.scale() as i32;
    let qr_side = qr.size() * MODULE;
    let side = (qr_side + scale - 1) / scale + 2 * PADDING;
    let panel = Rectangle::new(at, Size::new(side as u32, side as u32));
    RoundedRectangle::new(panel, CornerRadii::new(Size::new(3, 3)))
        .into_styled(PrimitiveStyle::with_stroke(INK, 1))
        .draw(px)?;

    let inset = (side * scale - qr_side) / 2;
    let origin = Point::new(at.x * scale + inset, at.y * scale + inset);
    let target = px.inner();
    for y in 0..qr.size() {
        for x in 0..qr.size() {
            if qr.get_module(x, y) {
                let module = Rectangle::new(
                    origin + Point::new(x * MODULE, y * MODULE),
                    Size::new(MODULE as u32, MODULE as u32),
                );
                target.fill_solid(&module, INK)?;
            }
        }
    }
    Ok(panel)
}

/// Black tabs anchored to the bottom edge, one above each touch key.
fn key_hints<D>(px: &mut D, left: &str, right: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    tab(px, KEY_LEFT_X, left)?;
    tab(px, KEY_RIGHT_X, right)
}

/// Black tab centred on `x` against the bottom edge, its label pointing down.
fn tab<D>(px: &mut D, x: i32, label: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let label_width = PRIMARY
        .get_rendered_dimensions(label, Point::zero(), VerticalPosition::Baseline)
        .ok()
        .and_then(|d| d.bounding_box)
        .map_or(30, |b| b.size.width as i32);
    let tab_width = label_width + icons::ARROW_DOWN.width() + 10;
    let tab = Rectangle::new(Point::new(x - tab_width / 2, H - 13), Size::new(tab_width as u32, 14));
    RoundedRectangle::new(tab, CornerRadii::new(Size::new(3, 3)))
        .into_styled(PrimitiveStyle::with_fill(INK))
        .draw(px)?;
    let text_x = tab.top_left.x + 4;
    if let Err(u8g2_fonts::Error::DisplayError(e)) =
        PRIMARY.render(label, Point::new(text_x, H - 4), VerticalPosition::Baseline, FontColor::Transparent(PAPER), px)
    {
        return Err(e);
    }
    icons::ARROW_DOWN.draw_colored(px, Point::new(text_x + label_width + 3, H - 8), PAPER)
}

/// Side of an item picture in canvas pixels.
const ITEM_IMAGE: i32 = ITEM_IMAGE_SIZE as i32;

/// An item's 24 x 24 picture at `scale`, or an empty frame when there is none.
fn picture<D>(px: &mut D, bits: Option<&[u8]>, at: Point, scale: i32) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    let side = ITEM_IMAGE * scale;
    let Some(bits) = bits.filter(|b| b.len() * 8 >= (ITEM_IMAGE * ITEM_IMAGE) as usize) else {
        return Rectangle::new(at, Size::new(side as u32, side as u32))
            .into_styled(PrimitiveStyle::with_stroke(INK, 1))
            .draw(px);
    };
    for y in 0..ITEM_IMAGE {
        for x in 0..ITEM_IMAGE {
            let i = (y * ITEM_IMAGE + x) as usize;
            if bits[i >> 3] & (0x80 >> (i & 7)) != 0 {
                Rectangle::new(at + Point::new(x * scale, y * scale), Size::new(scale as u32, scale as u32))
                    .into_styled(PrimitiveStyle::with_fill(INK))
                    .draw(px)?;
            }
        }
    }
    Ok(())
}

/// A centred line of small text above the bottom edge.
fn footer<D>(px: &mut D, line: &str) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    for x in (0..W).step_by(2) {
        Pixel(Point::new(x, H - 13), INK).draw(px)?;
    }
    centered(px, &SECONDARY, line, W / 2, H - 3)
}

/// Draws `s` wrapped to `width`, returns the baseline under the last line.
fn paragraph<D>(px: &mut D, font: &FontRenderer, s: &str, x: i32, top: i32, width: i32) -> Result<i32, D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    const LINE: i32 = 10;
    let mut y = top;
    for line in wrap(font, s, width) {
        text(px, font, &line, Point::new(x, y))?;
        y += LINE;
    }
    Ok(y)
}

/// Splits `s` into lines no wider than `width` logical pixels.
fn wrap(font: &FontRenderer, s: &str, width: i32) -> Vec<String> {
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in s.split_whitespace() {
        let candidate = if line.is_empty() { word.to_owned() } else { format!("{line} {word}") };
        if !line.is_empty() && text_width(font, &candidate) > width {
            lines.push(std::mem::replace(&mut line, word.to_owned()));
        } else {
            line = candidate;
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

fn text_width(font: &FontRenderer, s: &str) -> i32 {
    font.get_rendered_dimensions(s, Point::zero(), VerticalPosition::Baseline)
        .map_or(0, |d| d.advance.x)
}

fn text<D>(px: &mut D, font: &FontRenderer, s: &str, at: Point) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    render(font, px, s, at, HorizontalAlignment::Left)
}

fn centered<D>(px: &mut D, font: &FontRenderer, s: &str, x: i32, baseline: i32) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    render(font, px, s, Point::new(x, baseline), HorizontalAlignment::Center)
}

fn render<D>(font: &FontRenderer, px: &mut D, s: &str, at: Point, align: HorizontalAlignment) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    match font.render_aligned(s, at, VerticalPosition::Baseline, align, FontColor::Transparent(INK), px) {
        Err(u8g2_fonts::Error::DisplayError(e)) => Err(e),
        // A missing glyph must not stop the screen from drawing.
        _ => Ok(()),
    }
}
