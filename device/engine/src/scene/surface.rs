//! Monochrome surface compositing, with deterministic ordered opacity and no framebuffer copy.
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::{ContainsPoint, CornerRadii, PrimitiveStyle, PrimitiveStyleBuilder, Rectangle, RoundedRectangle, StrokeAlignment}};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceStyle {
    /// 255 follows the active theme; explicit radii are in logical pixels.
    pub radius: u8,
    pub border_width: u8,
    pub border_style: u8,
    pub background: u8,
    pub opacity: u8,
    pub shadow: Option<Shadow>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Shadow { pub x: i16, pub y: i16, pub opacity: u8 }
impl SurfaceStyle {
    pub(super) fn valid(&self) -> bool {
        (self.radius <= 64 || self.radius == 255) && self.border_width <= 3
            && self.border_style <= 2 && self.background <= 2 && self.opacity <= 100
            && self.shadow.as_ref().is_none_or(|s| s.x.unsigned_abs() <= 16 && s.y.unsigned_abs() <= 16 && s.opacity <= 100)
    }
    fn shape(&self, area: Rectangle, theme_radius: u32) -> RoundedRectangle {
        let radius = if self.radius == 255 { theme_radius } else { self.radius as u32 };
        let radius = radius.min(area.size.width / 2).min(area.size.height / 2);
        RoundedRectangle::new(area, CornerRadii::new(Size::new(radius, radius)))
    }
    pub(super) fn shadow<D: DrawTarget<Color = BinaryColor>>(&self, d: &mut D, area: Rectangle, radius: u32) -> Result<(), D::Error> {
        let Some(shadow) = &self.shadow else { return Ok(()) };
        let base = self.shape(area, radius);
        let shifted = self.shape(area.translate(Point::new(shadow.x as i32, shadow.y as i32)), radius);
        d.draw_iter(shifted.into_styled(PrimitiveStyle::with_fill(BinaryColor::On)).pixels()
            .filter(|Pixel(p, _)| !base.contains(*p) && coverage(*p, shadow.opacity)))
    }
    pub(super) fn draw<D: DrawTarget<Color = BinaryColor>>(&self, d: &mut D, area: Rectangle, radius: u32) -> Result<(), D::Error> {
        let shape = self.shape(area, radius);
        if self.background != 2 && self.opacity != 0 {
            let color = if self.background == 1 { BinaryColor::On } else { BinaryColor::Off };
            d.draw_iter(shape.into_styled(PrimitiveStyle::with_fill(color)).pixels().filter(|Pixel(p, _)| coverage(*p, self.opacity)))?;
        }
        if self.border_width > 0 {
            let style = PrimitiveStyleBuilder::new().stroke_color(BinaryColor::On)
                .stroke_width(self.border_width as u32).stroke_alignment(StrokeAlignment::Inside).build();
            d.draw_iter(shape.into_styled(style).pixels().filter(|Pixel(p, _)| match self.border_style {
                1 => (p.x + p.y).rem_euclid(6) < 3,
                2 => (p.x + p.y).rem_euclid(2) == 0,
                _ => true,
            }))?;
        }
        Ok(())
    }
}
fn coverage(point: Point, opacity: u8) -> bool {
    const BAYER: [[u8; 4]; 4] = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    (BAYER[point.y.rem_euclid(4) as usize][point.x.rem_euclid(4) as usize] as u16 * 100 + 50) < opacity as u16 * 16
}
