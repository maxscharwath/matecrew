//! Monochrome surface compositing, with deterministic ordered opacity and no framebuffer copy.
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::{ContainsPoint, CornerRadii, PrimitiveStyle, PrimitiveStyleBuilder, Rectangle, RoundedRectangle, StrokeAlignment}};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceStyle {
    /// 255 follows the active theme; explicit radii (up to 254) are in logical pixels, capped at half the side.
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
        self.border_width <= 3
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
            let fill = shape.into_styled(PrimitiveStyle::with_fill(color));
            if self.opacity >= 100 {
                // Opaque: whole scanlines through `fill_solid`, bytes at a time, not pixel by pixel.
                fill.draw(d)?;
            } else {
                // Dithered: the shape's own scanlines, then only the columns the Bayer cell lights.
                let mut spans = Spans { bounds: fill.bounding_box(), rows: Vec::new() };
                let _ = fill.draw(&mut spans);
                for (y, from, to) in spans.rows {
                    let lit = BAYER[y.rem_euclid(4) as usize].map(|cell| lit(cell, self.opacity));
                    d.draw_iter((from..=to).filter(|x| lit[x.rem_euclid(4) as usize]).map(|x| Pixel(Point::new(x, y), color)))?;
                }
            }
        }
        if self.border_width > 0 {
            let style = PrimitiveStyleBuilder::new().stroke_color(BinaryColor::On)
                .stroke_width(self.border_width as u32).stroke_alignment(StrokeAlignment::Inside).build();
            let border = shape.into_styled(style);
            if self.border_style == 0 {
                border.draw(d)?;
            } else {
                d.draw_iter(border.pixels().filter(|Pixel(p, _)| match self.border_style {
                    1 => (p.x + p.y).rem_euclid(6) < 3,
                    _ => (p.x + p.y).rem_euclid(2) == 0,
                }))?;
            }
        }
        Ok(())
    }
}
const BAYER: [[u8; 4]; 4] = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
/// A Bayer cell is lit at this opacity (percent).
fn lit(cell: u8, opacity: u8) -> bool {
    (cell as u16 * 100 + 50) < opacity as u16 * 16
}
fn coverage(point: Point, opacity: u8) -> bool {
    lit(BAYER[point.y.rem_euclid(4) as usize][point.x.rem_euclid(4) as usize], opacity)
}

/// Records the horizontal runs embedded-graphics fills a shape with: `(y, first x, last x)`.
struct Spans {
    bounds: Rectangle,
    rows: Vec<(i32, i32, i32)>,
}
impl Dimensions for Spans {
    fn bounding_box(&self) -> Rectangle {
        self.bounds
    }
}
impl DrawTarget for Spans {
    type Color = BinaryColor;
    type Error = core::convert::Infallible;
    fn draw_iter<I: IntoIterator<Item = Pixel<BinaryColor>>>(&mut self, pixels: I) -> Result<(), Self::Error> {
        self.rows.extend(pixels.into_iter().map(|Pixel(p, _)| (p.y, p.x, p.x)));
        Ok(())
    }
    fn fill_solid(&mut self, area: &Rectangle, _: BinaryColor) -> Result<(), Self::Error> {
        if let Some(end) = area.bottom_right() {
            self.rows.extend((area.top_left.y..=end.y).map(|y| (y, area.top_left.x, end.x)));
        }
        Ok(())
    }
}
