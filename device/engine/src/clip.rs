//! A draw target cut to a rectangle, like embedded-graphics' `Clipped`, with its bounds computed
//! once: every pixel of a frame passes through two of them (the screen, then its node's cell),
//! so the per-pixel test is four integer comparisons.
use embedded_graphics::{prelude::*, primitives::Rectangle};

pub struct Clip<'a, D> {
    target: &'a mut D,
    area: Rectangle,
    /// Inclusive left and top, exclusive right and bottom.
    edges: [i32; 4],
}

impl<'a, D: DrawTarget> Clip<'a, D> {
    pub fn new(target: &'a mut D, area: Rectangle) -> Self {
        let area = area.intersection(&target.bounding_box());
        let edges = [
            area.top_left.x,
            area.top_left.y,
            area.top_left.x + area.size.width as i32,
            area.top_left.y + area.size.height as i32,
        ];
        Self { target, area, edges }
    }
}

impl<D: DrawTarget> Dimensions for Clip<'_, D> {
    fn bounding_box(&self) -> Rectangle {
        self.area
    }
}

impl<D: DrawTarget> DrawTarget for Clip<'_, D> {
    type Color = D::Color;
    type Error = D::Error;

    fn draw_iter<I: IntoIterator<Item = Pixel<Self::Color>>>(&mut self, pixels: I) -> Result<(), Self::Error> {
        let [left, top, right, bottom] = self.edges;
        self.target.draw_iter(
            pixels
                .into_iter()
                .filter(move |Pixel(p, _)| p.x >= left && p.x < right && p.y >= top && p.y < bottom),
        )
    }

    fn fill_solid(&mut self, area: &Rectangle, color: Self::Color) -> Result<(), Self::Error> {
        let area = area.intersection(&self.area);
        if area.size.width == 0 || area.size.height == 0 {
            return Ok(());
        }
        self.target.fill_solid(&area, color)
    }

    fn clear(&mut self, color: Self::Color) -> Result<(), Self::Error> {
        let area = self.area;
        self.fill_solid(&area, color)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::Frame;
    use embedded_graphics::pixelcolor::BinaryColor;

    #[test]
    fn keeps_only_what_falls_inside_like_clipped() {
        let area = Rectangle::new(Point::new(3, 2), Size::new(5, 4));
        let draw = |d: &mut dyn FnMut(&mut Frame)| {
            let mut frame = Frame::new(16, 10).unwrap();
            d(&mut frame);
            frame.bits
        };
        let pixels = || (0..16).flat_map(|x| (0..10).map(move |y| Pixel(Point::new(x, y), BinaryColor::On)));
        let ours = draw(&mut |f| {
            Clip::new(f, area).draw_iter(pixels()).unwrap();
            Clip::new(f, Rectangle::new(Point::new(10, 0), Size::new(20, 3))).fill_solid(&Rectangle::new(Point::new(8, 1), Size::new(6, 6)), BinaryColor::On).unwrap();
        });
        let theirs = draw(&mut |f| {
            f.clipped(&area).draw_iter(pixels()).unwrap();
            f.clipped(&Rectangle::new(Point::new(10, 0), Size::new(20, 3))).fill_solid(&Rectangle::new(Point::new(8, 1), Size::new(6, 6)), BinaryColor::On).unwrap();
        });
        assert_eq!(ours, theirs);
    }
}
