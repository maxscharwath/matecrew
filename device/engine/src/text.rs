use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::Rectangle};
use std::cell::RefCell;
use u8g2_fonts::{
    types::{FontColor, HorizontalAlignment, VerticalPosition},
    FontRenderer,
};

/// What measuring a string tells: its advance and the box its ink covers.
#[derive(Clone, Copy)]
struct Measure {
    advance: i32,
    ink: Option<Rectangle>,
}
/// Direct-mapped memo of recent measurements. Layout measures a label several times a frame
/// (flex sizing, `fit`, wrapping) and a redraw measures the same labels again: each measure
/// decodes every glyph, the bulk of a screen's CPU time once pixels are cheap.
const MEMO: usize = 256;
type Slot = Option<(u64, usize, Option<Measure>)>;
thread_local! {
    static MEASURES: RefCell<Vec<Slot>> = RefCell::new(vec![None; MEMO]);
}
/// FNV-1a over the font's address and the text: fonts are statics, so the address names one.
fn key(font: &FontRenderer, s: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in (font as *const FontRenderer as usize).to_le_bytes().iter().chain(s.as_bytes()) {
        hash = (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3);
    }
    hash
}
fn measure(font: &FontRenderer, s: &str) -> Option<Measure> {
    let key = key(font, s);
    let slot = (key % MEMO as u64) as usize;
    let cached = MEASURES.with_borrow(|memo| match memo[slot] {
        Some((k, len, measure)) if k == key && len == s.len() => Some(measure),
        _ => None,
    });
    if let Some(measure) = cached {
        return measure;
    }
    let measure = font
        .get_rendered_dimensions(s, Point::zero(), VerticalPosition::Baseline)
        .ok()
        .map(|d| Measure { advance: d.advance.x, ink: d.bounding_box });
    MEASURES.with_borrow_mut(|memo| memo[slot] = Some((key, s.len(), measure)));
    measure
}

pub fn width(font: &FontRenderer, s: &str) -> i32 {
    spaced_width(font, s, 0)
}
/// Advance of `s` with `tracking` extra pixels between glyphs (u8g2 fonts have no kerning).
pub fn spaced_width(font: &FontRenderer, s: &str, tracking: i32) -> i32 {
    measure(font, s).map_or(0, |m| m.advance) + tracking * (s.chars().count() as i32 - 1).max(0)
}
/// Text fitting uses real glyph metrics, substitutes unsupported characters, and never silently disappears.
pub fn fit(font: &FontRenderer, s: &str, width: i32) -> String {
    fit_spaced(font, s, width, 0)
}
pub fn fit_spaced(font: &FontRenderer, s: &str, width: i32, tracking: i32) -> String {
    let measure = |text: &str| {
        measure(font, text).map(|m| {
            m.advance.max(m.ink.and_then(|b| b.bottom_right()).map_or(0, |p| p.x + 1))
                + tracking * (text.chars().count() as i32 - 1).max(0)
        })
    };
    // Most labels already fit and use supported glyphs: measure once, with no per-glyph allocations.
    if !s.chars().any(char::is_control) && measure(s).is_some_and(|pixels| pixels <= width) {
        return s.to_owned();
    }
    let mut out = String::new();
    for c in s.chars() {
        let c = if c.is_control() { ' ' } else { c };
        let c = if font
            .get_rendered_dimensions(
                c.to_string().as_str(),
                Point::zero(),
                VerticalPosition::Baseline,
            )
            .is_ok()
        {
            c
        } else {
            '?'
        };
        out.push(c);
        if measure(&out).is_none_or(|pixels| pixels > width) {
            out.pop();
            while !out.is_empty()
                && measure(&format!("{out}...")).is_none_or(|pixels| pixels > width)
            {
                out.pop();
            }
            return if measure("...").is_some_and(|pixels| pixels <= width) {
                format!("{out}...")
            } else {
                String::new()
            };
        }
    }
    out
}

pub fn lines(font: &FontRenderer, s: &str, width: i32, max: usize) -> Vec<String> {
    spaced_lines(font, s, width, max, 0)
}
pub fn spaced_lines(font: &FontRenderer, s: &str, width: i32, max: usize, tracking: i32) -> Vec<String> {
    if max == 0 || width <= 0 {
        return vec![];
    }
    let fit = |text: &str, width: i32| fit_spaced(font, text, width, tracking);
    let mut lines = Vec::new();
    let mut line = String::new();
    let mut words = s.split_whitespace().peekable();
    while let Some(word) = words.next() {
        let word = fit(word, width);
        let candidate = if line.is_empty() {
            word.clone()
        } else {
            format!("{line} {word}")
        };
        if !line.is_empty() && fit(&candidate, width) != candidate {
            lines.push(line);
            line = word;
            if lines.len() == max {
                // Keep the overflow visible without growing past the component.
                if let Some(last) = lines.last_mut() {
                    *last = fit(&format!("{last}..."), width);
                }
                return lines;
            }
        } else {
            line = candidate;
        }
        if words.peek().is_none() {
            break;
        }
    }
    if !line.is_empty() && lines.len() < max {
        lines.push(line);
    }
    lines
}

pub fn label<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    font: &FontRenderer,
    s: &str,
    at: Point,
    width: i32,
    color: BinaryColor,
    align: HorizontalAlignment,
) -> Result<(), D::Error> {
    spaced_label(d, font, s, at, width, color, align, 0)
}
#[allow(clippy::too_many_arguments)]
pub fn spaced_label<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    font: &FontRenderer,
    s: &str,
    at: Point,
    width: i32,
    color: BinaryColor,
    align: HorizontalAlignment,
    tracking: i32,
) -> Result<(), D::Error> {
    let s = fit_spaced(font, s, width, tracking);
    let draw = |d: &mut D, text: &str, x: i32| match font.render_aligned(
        text,
        Point::new(x, at.y),
        VerticalPosition::Baseline,
        HorizontalAlignment::Left,
        FontColor::Transparent(color),
        d,
    ) {
        Err(u8g2_fonts::Error::DisplayError(e)) => Err(e),
        _ => Ok(()),
    };
    if tracking > 0 {
        let total = spaced_width(font, &s, tracking);
        let mut x = match align {
            HorizontalAlignment::Left => at.x,
            HorizontalAlignment::Center => at.x - total / 2,
            HorizontalAlignment::Right => at.x - total,
        };
        let mut glyph = [0u8; 4];
        for c in s.chars() {
            let text = c.encode_utf8(&mut glyph);
            draw(d, text, x)?;
            x += width_of(font, text) + tracking;
        }
        return Ok(());
    }
    let bounds = measure(font, s.as_str()).and_then(|m| m.ink);
    let x = bounds.map_or(at.x, |b| match align {
        HorizontalAlignment::Left => at.x - b.top_left.x,
        HorizontalAlignment::Center => at.x - b.top_left.x - b.size.width as i32 / 2,
        HorizontalAlignment::Right => at.x - b.top_left.x - b.size.width as i32,
    });
    draw(d, &s, x)
}
fn width_of(font: &FontRenderer, s: &str) -> i32 {
    measure(font, s).map_or(0, |m| m.advance)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::style;
    #[test]
    fn scene_text_preserves_all_accent_and_descender_pixels() {
        use crate::{frame::Frame, Scene, Theme};
        use serde_json::json;
        for role in ["caption", "body", "title", "display"] {
            let font = Theme::Macos.font(serde_json::from_value(json!(role)).unwrap());
            let height = font
                .get_font_bounding_box(VerticalPosition::Baseline)
                .size
                .height;
            let scene: Scene = serde_json::from_value(json!({"version":1,"width":400,"height":100,"state":{"theme":"macos"},"root":{"kind":"text","rect":{"x":10,"y":10,"width":350,"height":height},"value":{"literal":"ÉÀçgj"},"font":role,"align":"left","inverted":false,"maxLines":1}})).unwrap();
            let mut actual = Frame::new(400, 100).unwrap();
            scene.render(&mut actual, &json!({}), 1).unwrap();
            let mut expected = Frame::new(400, 100).unwrap();
            font.render_aligned(
                "ÉÀçgj",
                Point::new(20, 50),
                VerticalPosition::Baseline,
                HorizontalAlignment::Left,
                FontColor::Transparent(BinaryColor::On),
                &mut expected,
            )
            .unwrap();
            assert_eq!(
                actual.bits.iter().map(|b| b.count_ones()).sum::<u32>(),
                expected.bits.iter().map(|b| b.count_ones()).sum::<u32>(),
                "{role} clips glyph pixels"
            );
        }
    }
    #[test]
    fn accents_unsupported_glyphs_and_wrapped_labels_fit_actual_font_widths() {
        for font in [
            &style::TITLE,
            &style::BODY,
            &style::CAPTION,
            &style::DISPLAY,
        ] {
            for max_width in [0, 12, 40, 84, 192] {
                let result = fit(font, "Maté très long 漢字 🙂", max_width);
                assert!(width(font, &result) <= max_width);
                assert!(!result.contains('漢'));
                let wrapped = lines(
                    font,
                    "Très long nom avec accents et beaucoup de mots",
                    max_width,
                    2,
                );
                assert!(wrapped.len() <= 2);
                assert!(wrapped.iter().all(|line| width(font, line) <= max_width));
            }
        }
    }
}
