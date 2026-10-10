//! Native bitmap typography. Synthetic oblique/bold reserve their extra ink in layout.
use super::Font;
use crate::Theme;
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::Rectangle};
use serde::{Deserialize, Serialize};
use u8g2_fonts::{fonts, FontRenderer};

/// Families: 0 theme default, 1 pixel, 2 sans (Helvetica), 3 mono (ProFont),
/// 4 grotesk (Free Universal, a Univers-like grotesque), 5 numeric (Logisoso, condensed figures).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Typography {
    pub family: u8,
    pub size: u8,
    pub weight: u8,
    pub italic: bool,
    /// Extra pixels between glyphs, for spaced capitals.
    #[serde(default)]
    pub tracking: u8,
    /// Too long for its box: smaller sizes of the family before an ellipsis.
    #[serde(default)]
    pub fit: bool,
}
pub const GROTESK: u8 = 4;
pub const NUMERIC: u8 = 5;
const CLASSIC_SIZES: [u8; 6] = [8, 10, 12, 14, 18, 24];
/// 49 has figures only.
pub const GROTESK_SIZES: [u8; 9] = [11, 14, 17, 20, 25, 30, 35, 42, 49];
/// 62, 78 and 92 have figures only.
pub const NUMERIC_SIZES: [u8; 10] = [20, 24, 28, 32, 38, 46, 58, 62, 78, 92];
pub const MAX_TRACKING: u8 = 16;
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
const GROTESK_REGULAR: [FontRenderer; 9] = [
    FontRenderer::new::<fonts::u8g2_font_fur11_tf>(), FontRenderer::new::<fonts::u8g2_font_fur14_tf>(),
    FontRenderer::new::<fonts::u8g2_font_fur17_tf>(), FontRenderer::new::<fonts::u8g2_font_fur20_tf>(),
    FontRenderer::new::<fonts::u8g2_font_fur25_tf>(), FontRenderer::new::<fonts::u8g2_font_fur30_tf>(),
    FontRenderer::new::<fonts::u8g2_font_fur35_tf>(), FontRenderer::new::<fonts::u8g2_font_fur42_tf>(),
    FontRenderer::new::<fonts::u8g2_font_fur49_tn>(),
];
const GROTESK_BOLD: [FontRenderer; 9] = [
    FontRenderer::new::<fonts::u8g2_font_fub11_tf>(), FontRenderer::new::<fonts::u8g2_font_fub14_tf>(),
    FontRenderer::new::<fonts::u8g2_font_fub17_tf>(), FontRenderer::new::<fonts::u8g2_font_fub20_tf>(),
    FontRenderer::new::<fonts::u8g2_font_fub25_tf>(), FontRenderer::new::<fonts::u8g2_font_fub30_tf>(),
    FontRenderer::new::<fonts::u8g2_font_fub35_tf>(), FontRenderer::new::<fonts::u8g2_font_fub42_tf>(),
    FontRenderer::new::<fonts::u8g2_font_fub49_tn>(),
];
const FIGURES: [FontRenderer; 10] = [
    FontRenderer::new::<fonts::u8g2_font_logisoso20_tf>(), FontRenderer::new::<fonts::u8g2_font_logisoso24_tf>(),
    FontRenderer::new::<fonts::u8g2_font_logisoso28_tf>(), FontRenderer::new::<fonts::u8g2_font_logisoso32_tf>(),
    FontRenderer::new::<fonts::u8g2_font_logisoso38_tf>(), FontRenderer::new::<fonts::u8g2_font_logisoso46_tf>(),
    FontRenderer::new::<fonts::u8g2_font_logisoso58_tf>(), FontRenderer::new::<fonts::u8g2_font_logisoso62_tn>(),
    FontRenderer::new::<fonts::u8g2_font_logisoso78_tn>(), FontRenderer::new::<fonts::u8g2_font_logisoso92_tn>(),
];
/// Role fonts of the `paper` and `dark` themes: the grotesque at native resolution.
pub(crate) const PAPER_CAPTION: &FontRenderer = &GROTESK_REGULAR[1];
pub(crate) const PAPER_BODY: &FontRenderer = &GROTESK_REGULAR[2];
pub(crate) const PAPER_TITLE: &FontRenderer = &GROTESK_BOLD[4];
pub(crate) const PAPER_DISPLAY: &FontRenderer = &GROTESK_BOLD[7];
pub(super) struct Resolved { pub font: &'static FontRenderer, pub embolden: bool, pub italic: bool, pub tracking: i32 }
impl Typography {
    pub(super) fn valid(&self) -> bool {
        let sizes: &[u8] = match self.family {
            GROTESK => &GROTESK_SIZES,
            NUMERIC => &NUMERIC_SIZES,
            0..=3 => &CLASSIC_SIZES,
            _ => return false,
        };
        (self.size == 0 || sizes.contains(&self.size)) && self.weight <= 2 && self.tracking <= MAX_TRACKING
    }
    /// The family a theme draws this style in.
    fn family(&self, theme: Theme) -> u8 {
        if self.family == 0 {
            match theme { Theme::Flipper => 1, Theme::Macos => 2, Theme::Paper | Theme::Dark => GROTESK }
        } else { self.family }
    }
    /// The largest size of the family, from this style's own down, whose text `fits`; the
    /// smallest when none does. Without `fit`, the style's own size.
    pub(super) fn fitted(&self, theme: Theme, role: Font, fits: impl Fn(&Resolved) -> bool) -> Resolved {
        let own = self.resolve(theme, role);
        if !self.fit || fits(&own) {
            return own;
        }
        let sizes: &[u8] = match self.family(theme) {
            GROTESK => &GROTESK_SIZES,
            NUMERIC => &NUMERIC_SIZES,
            _ => &CLASSIC_SIZES,
        };
        let height = |r: &Resolved| r.font.get_font_bounding_box(u8g2_fonts::types::VerticalPosition::Baseline).size.height;
        let current = height(&own);
        let mut last = own;
        for &size in sizes.iter().rev() {
            let smaller = Typography { size, fit: false, ..self.clone() }.resolve(theme, role);
            if height(&smaller) >= current {
                continue;
            }
            if fits(&smaller) {
                return smaller;
            }
            last = smaller;
        }
        last
    }
    pub(super) fn resolve(&self, theme: Theme, role: Font) -> Resolved {
        let family = self.family(theme);
        let bold = self.weight == 2 || (self.weight == 0 && role == Font::Title);
        let tracking = i32::from(self.tracking);
        let pick = |sizes: &[u8], default: u8| {
            let size = if self.size == 0 { default } else { self.size };
            sizes.iter().position(|n| *n == size).unwrap_or(0)
        };
        let (font, embolden) = match family {
            GROTESK => {
                let i = pick(&GROTESK_SIZES, match role { Font::Caption => 14, Font::Body => 17, Font::Title => 25, Font::Display => 42 });
                (if bold { &GROTESK_BOLD[i] } else { &GROTESK_REGULAR[i] }, false)
            }
            // Logisoso has one weight, already heavy.
            NUMERIC => (&FIGURES[pick(&NUMERIC_SIZES, match role { Font::Caption => 20, Font::Body => 24, Font::Title => 38, Font::Display => 62 })], false),
            _ => {
                let i = pick(&CLASSIC_SIZES, match role { Font::Caption => 10, Font::Body => 12, Font::Title => 18, Font::Display => 24 });
                match family {
                    2 => (if bold { &SANS_BOLD[i] } else { &SANS[i] }, false),
                    3 => (&MONO[i], bold),
                    _ if bold && (2..=4).contains(&i) => (&PIXEL_BOLD[i - 2], false),
                    _ => (&PIXEL[i], bold),
                }
            }
        };
        Resolved { font, embolden, italic: self.italic, tracking }
    }
}
impl Resolved {
    pub(super) fn plain(font: &'static FontRenderer) -> Self { Self { font, embolden: false, italic: false, tracking: 0 } }
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
