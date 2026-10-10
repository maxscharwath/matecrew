//! QR codes drawn for phones and for people: crisp modules on a guaranteed paper quiet zone,
//! optional dot or rounded modules, rounded finder patterns and a centred logo.
use super::ButtonIcon;
use crate::sprite::PackedSprite;
use embedded_graphics::{
    pixelcolor::BinaryColor,
    prelude::*,
    primitives::{Circle, CornerRadii, PrimitiveStyle, Rectangle, RoundedRectangle},
};
use qrcodegen::{QrCode, QrCodeEcc};
use std::sync::Mutex;

/// The last codes encoded, by payload and correction level: a screen redrawn with the same link
/// (a clock tick, a key) skips the Reed–Solomon and mask search, most of a QR screen's CPU time.
static ENCODED: Mutex<Vec<(String, QrCodeEcc, QrCode)>> = Mutex::new(Vec::new());
const KEEP: usize = 2;

fn encode(payload: &str, ecc: QrCodeEcc) -> Option<QrCode> {
    let mut cache = ENCODED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(at) = cache.iter().position(|(p, e, _)| p == payload && *e == ecc) {
        let entry = cache.remove(at);
        let qr = entry.2.clone();
        cache.push(entry);
        return Some(qr);
    }
    let qr = QrCode::encode_text(payload, ecc).ok()?;
    if cache.len() == KEEP {
        cache.remove(0);
    }
    cache.push((payload.to_owned(), ecc, qr.clone()));
    Some(qr)
}

pub(super) struct Qr<'a> {
    pub payload: &'a str,
    /// 0 square, 1 dots, 2 rounded (modules join, free corners round off).
    pub style: u8,
    pub ecc: u8,
    pub quiet: u8,
    pub logo: Option<&'a ButtonIcon>,
    /// Paper and ink as drawn: a dark theme swaps them, the code stays black on white.
    pub paper: BinaryColor,
    pub ink: BinaryColor,
}

impl Qr<'_> {
    pub(super) fn draw<D: DrawTarget<Color = BinaryColor>>(&self, d: &mut D, area: Rectangle) -> Result<(), D::Error> {
        // A logo hides modules: only high error correction recovers them reliably.
        let ecc = match if self.logo.is_some() { 3 } else { self.ecc } {
            0 => QrCodeEcc::Low,
            1 => QrCodeEcc::Medium,
            2 => QrCodeEcc::Quartile,
            _ => QrCodeEcc::High,
        };
        let Some(qr) = encode(self.payload, ecc) else { return Ok(()) };
        let n = qr.size();
        // Modules are whole pixels: give back quiet zone (down to one module) when that buys a
        // bigger module, instead of leaving the rounding as a wide white margin.
        let room = area.size.width.min(area.size.height);
        let floor = i32::from(self.quiet.min(1));
        let (quiet, module) = (floor..=i32::from(self.quiet))
            .map(|q| (q, room / (n + 2 * q) as u32))
            .max_by_key(|&(q, m)| (m, q))
            .unwrap_or((0, 0));
        let side = (n + 2 * quiet) as u32;
        if module == 0 {
            return Ok(());
        }
        let m = module as i32;
        let origin = area.top_left
            + Point::new(
                (area.size.width - side * module) as i32 / 2,
                (area.size.height - side * module) as i32 / 2,
            );
        // The whole cell is paper: the quiet zone survives dark themes and patterned backgrounds.
        d.fill_solid(&area, self.paper)?;
        let at = |x: i32, y: i32| origin + Point::new((x + quiet) * m, (y + quiet) * m);
        let dark = |x: i32, y: i32| x >= 0 && y >= 0 && x < n && y < n && qr.get_module(x, y);

        // Centre plate for the logo, in whole modules: at most 36 % of the side (13 % of the area),
        // well within what high error correction (30 %) recovers.
        let plate = self.logo.and_then(|logo| {
            let span = (logo.width.max(logo.height) as i32 + 2 * m + m - 1) / m;
            let span = span + (span + n) % 2; // same parity as n: centred on a module
            (span * 100 <= n * 36).then_some(((n - span) / 2, span))
        });
        let finders = [(0, 0), (n - 7, 0), (0, n - 7)];
        let alignments = alignment_centres(qr.version().value() as i32, n);
        // Never hide an alignment pattern: scanners need them to correct perspective.
        let plate = plate.filter(|&(start, span)| {
            alignments.iter().all(|&(cx, cy)| cx + 2 < start || cx - 2 >= start + span || cy + 2 < start || cy - 2 >= start + span)
        });
        let covered = |x: i32, y: i32| plate.is_some_and(|(start, span)| (start..start + span).contains(&x) && (start..start + span).contains(&y));

        let in_finder = |x: i32, y: i32| finders.iter().any(|&(fx, fy)| (fx..fx + 7).contains(&x) && (fy..fy + 7).contains(&y));
        let in_alignment = |x: i32, y: i32| alignments.iter().any(|&(cx, cy)| (x - cx).abs() <= 2 && (y - cy).abs() <= 2);
        let styled = self.style > 0 && m >= 3;

        for y in 0..n {
            for x in 0..n {
                if !dark(x, y) || covered(x, y) || (styled && (in_finder(x, y) || in_alignment(x, y))) {
                    continue;
                }
                let cell = Rectangle::new(at(x, y), Size::new(module, module));
                match self.style {
                    1 if styled => Circle::new(cell.top_left, module).into_styled(PrimitiveStyle::with_fill(self.ink)).draw(d)?,
                    2 if styled => {
                        d.fill_solid(&cell, self.ink)?;
                        // Round a corner only where both neighbours on that side are light.
                        let r = (m / 2).max(1);
                        for (dx, dy) in [(-1, -1), (1, -1), (-1, 1), (1, 1)] {
                            if !dark(x + dx, y) && !dark(x, y + dy) {
                                round_corner(d, cell, dx, dy, r, self.paper)?;
                            }
                        }
                    }
                    _ => d.fill_solid(&cell, self.ink)?,
                }
            }
        }
        if styled {
            for &(fx, fy) in &finders {
                ring(d, at(fx, fy), 7, m, self.ink, self.paper)?;
            }
            for &(cx, cy) in &alignments {
                ring(d, at(cx - 2, cy - 2), 5, m, self.ink, self.paper)?;
            }
        }
        if let (Some(logo), Some((start, span))) = (self.logo, plate) {
            let plate = Rectangle::new(at(start, start), Size::new((span * m) as u32, (span * m) as u32));
            d.fill_solid(&plate, self.paper)?;
            if let Some(sprite) = PackedSprite::new(&logo.bits, Size::new(logo.width, logo.height)) {
                let corner = plate.center() - Point::new(logo.width as i32 / 2, logo.height as i32 / 2);
                sprite.draw(d, corner, 1, self.ink, None)?;
            }
        }
        Ok(())
    }
}

/// Finder (7) or alignment (5) pattern: a rounded ring one module thick around a rounded core.
fn ring<D: DrawTarget<Color = BinaryColor>>(d: &mut D, top_left: Point, modules: i32, m: i32, ink: BinaryColor, paper: BinaryColor) -> Result<(), D::Error> {
    let outer = Rectangle::new(top_left, Size::new((modules * m) as u32, (modules * m) as u32));
    let radius = |r: i32| CornerRadii::new(Size::new(r as u32, r as u32));
    RoundedRectangle::new(outer, radius(m * modules / 3)).into_styled(PrimitiveStyle::with_fill(ink)).draw(d)?;
    let hole = Rectangle::new(top_left + Point::new(m, m), Size::new(((modules - 2) * m) as u32, ((modules - 2) * m) as u32));
    RoundedRectangle::new(hole, radius(m * (modules - 2) / 3)).into_styled(PrimitiveStyle::with_fill(paper)).draw(d)?;
    let core = modules - 4;
    let centre = Rectangle::new(top_left + Point::new(2 * m, 2 * m), Size::new((core * m) as u32, (core * m) as u32));
    RoundedRectangle::new(centre, radius((m * core / 3).max(m / 2))).into_styled(PrimitiveStyle::with_fill(ink)).draw(d)
}

/// Clear the outside of a quarter circle of radius `r` in one corner of `cell`.
fn round_corner<D: DrawTarget<Color = BinaryColor>>(d: &mut D, cell: Rectangle, dx: i32, dy: i32, r: i32, paper: BinaryColor) -> Result<(), D::Error> {
    let w = cell.size.width as i32;
    let corner_x = if dx < 0 { cell.top_left.x } else { cell.top_left.x + w - r };
    let corner_y = if dy < 0 { cell.top_left.y } else { cell.top_left.y + w - r };
    // Centre of the rounding circle, in doubled coordinates to stay on pixel centres.
    let cx2 = if dx < 0 { 2 * (corner_x + r) } else { 2 * corner_x };
    let cy2 = if dy < 0 { 2 * (corner_y + r) } else { 2 * corner_y };
    let pixels = (0..r).flat_map(move |j| (0..r).map(move |i| Point::new(corner_x + i, corner_y + j)));
    d.draw_iter(pixels.filter(move |p| {
        let (px, py) = (2 * p.x + 1 - cx2, 2 * p.y + 1 - cy2);
        px * px + py * py > 4 * r * r
    }).map(|p| Pixel(p, paper)))
}

/// Centres of the alignment patterns, as ISO 18004 places them (none in version 1).
fn alignment_centres(version: i32, size: i32) -> Vec<(i32, i32)> {
    if version == 1 {
        return vec![];
    }
    let count = version / 7 + 2;
    let step = if version == 32 { 26 } else { (version * 4 + count * 2 + 1) / (count * 2 - 2) * 2 };
    let mut positions: Vec<i32> = (0..count - 1).map(|i| size - 7 - i * step).collect();
    positions.push(6);
    positions.reverse();
    let last = count as usize - 1;
    let mut centres = vec![];
    for (i, &y) in positions.iter().enumerate() {
        for (j, &x) in positions.iter().enumerate() {
            // The three corners hold finder patterns.
            if !((i == 0 && j == 0) || (i == 0 && j == last) || (i == last && j == 0)) {
                centres.push((x, y));
            }
        }
    }
    centres
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn alignment_patterns_match_the_standard_table() {
        assert!(alignment_centres(1, 21).is_empty());
        assert_eq!(alignment_centres(2, 25), vec![(18, 18)]);
        // Version 7: 6, 22, 38 without the three finder corners.
        assert_eq!(alignment_centres(7, 45).len(), 6);
        assert!(alignment_centres(7, 45).contains(&(22, 22)));
    }
}
