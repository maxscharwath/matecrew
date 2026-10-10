//! Native bitmap typography. Synthetic oblique/bold reserve their extra ink in layout.
use super::Font;
use crate::Theme;
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::Rectangle};
use serde::{Deserialize, Serialize};
use u8g2_fonts::{fonts, FontRenderer};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Typography { pub family: u8, pub size: u8, pub weight: u8, pub italic: bool }
const PIXEL: [FontRenderer; 6] = [
    FontRenderer::new::<fonts::u8g2_font_5x8_tf>(), FontRenderer::new::<fonts::u8g2_font_6x10_tf>(),
    FontRenderer::new::<fonts::u8g2_font_6x12_tf>(), FontRenderer::new::<fonts::u8g2_font_7x14_tf>(),
    FontRenderer::new::<fonts::u8g2_font_9x18_tf>(), FontRenderer::new::<fonts::u8g2_font_spleen12x24_mf>(),
];
const PIXEL_BOLD: [FontRenderer; 3] = [FontRenderer::new::<fonts::u8g2_font_6x13B_tf>(), FontRenderer::new::<fonts::u8g2_font_7x14B_tf>(), FontRenderer::new::<fonts::u8g2_font_9x18B_tf>()];
const SANS: [FontRenderer; 6] = [
    FontRenderer::new::<fonts::u8g2_font_helvR08_tf>(), FontRenderer::new::<fonts::u8g2_font_helvR10_tf>(),
    FontRenderer::new::<fonts::u8g2_font_helvR12_tf>(), FontRenderer::new::<fonts::u8g2_font_helvR14_tf>(),
    FontRenderer::new::<fonts::u8g2_font_helvR18_tf>(), FontRenderer::new::<fonts::u8g2_font_helvR24_tf>(),
];
const SANS_BOLD: [FontRenderer; 6] = [
    FontRenderer::new::<fonts::u8g2_font_helvB08_tf>(), FontRenderer::new::<fonts::u8g2_font_helvB10_tf>(),
    FontRenderer::new::<fonts::u8g2_font_helvB12_tf>(), FontRenderer::new::<fonts::u8g2_font_helvB14_tf>(),
    FontRenderer::new::<fonts::u8g2_font_helvB18_tf>(), FontRenderer::new::<fonts::u8g2_font_helvB24_tf>(),
];
const MONO: [FontRenderer; 6] = [
    FontRenderer::new::<fonts::u8g2_font_profont10_mf>(), FontRenderer::new::<fonts::u8g2_font_profont11_mf>(),
    FontRenderer::new::<fonts::u8g2_font_profont12_mf>(), FontRenderer::new::<fonts::u8g2_font_profont15_mf>(),
    FontRenderer::new::<fonts::u8g2_font_profont17_mf>(), FontRenderer::new::<fonts::u8g2_font_profont22_mf>(),
];
pub(super) struct Resolved { pub font: &'static FontRenderer, pub embolden: bool, pub italic: bool }
impl Typography {
    pub(super) fn valid(&self) -> bool { self.family <= 3 && [0,8,10,12,14,18,24].contains(&self.size) && self.weight <= 2 }
    pub(super) fn resolve(&self, theme: Theme, role: Font) -> Resolved {
        let family = if self.family == 0 { if theme == Theme::Flipper { 1 } else { 2 } } else { self.family };
        let size = if self.size == 0 { match role { Font::Caption => 10, Font::Body => 12, Font::Title => 18, Font::Display => 24 } } else { self.size };
        let i = [8,10,12,14,18,24].iter().position(|n| *n == size).unwrap_or(2);
        let bold = self.weight == 2 || (self.weight == 0 && role == Font::Title);
        let (font, embolden) = match family {
            2 => (if bold { &SANS_BOLD[i] } else { &SANS[i] }, false),
            3 => (&MONO[i], bold),
            _ if bold && (2..=4).contains(&i) => (&PIXEL_BOLD[i-2], false),
            _ => (&PIXEL[i], bold),
        };
        Resolved { font, embolden, italic: self.italic }
    }
}
impl Resolved {
    pub(super) fn plain(font: &'static FontRenderer) -> Self { Self { font, embolden:false, italic:false } }
    pub(super) fn extra(&self) -> i32 {
        let height = self.font.get_font_bounding_box(u8g2_fonts::types::VerticalPosition::Baseline).size.height as i32;
        (if self.italic { (height + 4) / 5 } else { 0 }) + i32::from(self.embolden)
    }
}
pub(super) struct Ink<'a, D> { pub target: &'a mut D, pub baseline: i32, pub italic: bool, pub embolden: bool, pub max_shift: i32 }
impl<D: Dimensions> Dimensions for Ink<'_, D> { fn bounding_box(&self) -> Rectangle { self.target.bounding_box() } }
impl<D: DrawTarget<Color=BinaryColor>> DrawTarget for Ink<'_, D> {
    type Color = BinaryColor; type Error = D::Error;
    fn draw_iter<I: IntoIterator<Item=Pixel<BinaryColor>>>(&mut self, pixels:I)->Result<(),Self::Error> {
        let baseline=self.baseline; let italic=self.italic; let bold=self.embolden; let max=self.max_shift;
        self.target.draw_iter(pixels.into_iter().flat_map(move |Pixel(mut p,c)| {
            if italic { p.x += ((baseline-p.y).max(0)/5).min(max); }
            [Some(Pixel(p,c)), bold.then_some(Pixel(p+Point::new(1,0),c))].into_iter().flatten()
        }))
    }
}
