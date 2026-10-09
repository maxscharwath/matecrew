//! The panel's pixels as the site stores them: 800 x 480, rows top to bottom,
//! 8 pixels per byte, most significant bit first, 1 = ink. The firmware sends
//! these bytes to the panel and the site mirrors them; the virtual device
//! draws them on a canvas.

use crate::{HEIGHT, WIDTH};
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::Rectangle};

pub const BYTES: usize = (WIDTH * HEIGHT / 8) as usize;
const ROW: usize = (WIDTH / 8) as usize;

pub struct Frame {
    pub bits: Vec<u8>,
}

impl Default for Frame {
    fn default() -> Self {
        Self { bits: vec![0; BYTES] }
    }
}

impl Frame {
    pub fn new() -> Self {
        Self::default()
    }
}

/// A rectangle of the panel, its left and right edges on byte boundaries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Window {
    pub const FULL: Window = Window { x: 0, y: 0, width: WIDTH, height: HEIGHT };

    pub fn area(&self) -> u32 {
        self.width * self.height
    }

    /// The window's bytes out of a whole frame, row by row.
    pub fn bytes<'a>(&self, frame: &'a [u8]) -> impl Iterator<Item = u8> + 'a {
        let (x0, x1) = ((self.x / 8) as usize, ((self.x + self.width) / 8) as usize);
        let rows = self.y as usize..(self.y + self.height) as usize;
        rows.flat_map(move |y| frame[y * ROW + x0..y * ROW + x1].iter().copied())
    }
}

/// The smallest window holding every pixel that differs, or None when the
/// frames are the same: nothing to refresh.
pub fn changed(before: &[u8], after: &[u8]) -> Option<Window> {
    let (mut x0, mut x1, mut y0, mut y1) = (usize::MAX, 0, usize::MAX, 0);
    for (y, (a, b)) in before.chunks(ROW).zip(after.chunks(ROW)).enumerate() {
        let Some(first) = a.iter().zip(b).position(|(p, q)| p != q) else { continue };
        let last = ROW - 1 - a.iter().rev().zip(b.iter().rev()).position(|(p, q)| p != q).unwrap_or(0);
        x0 = x0.min(first);
        x1 = x1.max(last);
        y0 = y0.min(y);
        y1 = y;
    }
    (y0 != usize::MAX).then(|| Window {
        x: (x0 * 8) as u32,
        y: y0 as u32,
        width: ((x1 - x0 + 1) * 8) as u32,
        height: (y1 - y0 + 1) as u32,
    })
}

impl OriginDimensions for Frame {
    fn size(&self) -> Size {
        Size::new(WIDTH, HEIGHT)
    }
}

impl DrawTarget for Frame {
    type Color = BinaryColor;
    type Error = core::convert::Infallible;

    fn draw_iter<I>(&mut self, pixels: I) -> Result<(), Self::Error>
    where
        I: IntoIterator<Item = Pixel<Self::Color>>,
    {
        for Pixel(point, color) in pixels {
            let (Ok(x), Ok(y)) = (u32::try_from(point.x), u32::try_from(point.y)) else { continue };
            if x >= WIDTH || y >= HEIGHT {
                continue;
            }
            let i = (y * WIDTH + x) as usize;
            let mask = 0x80 >> (i & 7);
            if color.is_on() {
                self.bits[i >> 3] |= mask;
            } else {
                self.bits[i >> 3] &= !mask;
            }
        }
        Ok(())
    }

    /// Whole rows of bytes at once where the area allows it: most of what the
    /// screens draw is 4 x 4 blocks of the pixel-art canvas.
    fn fill_solid(&mut self, area: &Rectangle, color: Self::Color) -> Result<(), Self::Error> {
        let area = area.intersection(&self.bounding_box());
        let Some(bottom_right) = area.bottom_right() else { return Ok(()) };
        let (left, right) = (area.top_left.x as usize, bottom_right.x as usize);
        for y in area.top_left.y as usize..=bottom_right.y as usize {
            let row = &mut self.bits[y * ROW..(y + 1) * ROW];
            for x in left..=right {
                let mask = 0x80 >> (x & 7);
                if color.is_on() {
                    row[x >> 3] |= mask;
                } else {
                    row[x >> 3] &= !mask;
                }
            }
        }
        Ok(())
    }

    fn clear(&mut self, color: Self::Color) -> Result<(), Self::Error> {
        self.bits.fill(if color.is_on() { 0xff } else { 0 });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packs_ink_msb_first() {
        let mut frame = Frame::new();
        frame.draw_iter([Pixel(Point::new(0, 0), BinaryColor::On), Pixel(Point::new(9, 0), BinaryColor::On)]).unwrap();
        assert_eq!(frame.bits[0], 0x80);
        assert_eq!(frame.bits[1], 0x40);
        frame.draw_iter([Pixel(Point::new(0, 0), BinaryColor::Off), Pixel(Point::new(-1, 900), BinaryColor::On)]).unwrap();
        assert_eq!(frame.bits[0], 0);
    }

    #[test]
    fn fills_like_pixels() {
        let (mut fast, mut slow) = (Frame::new(), Frame::new());
        let area = Rectangle::new(Point::new(5, 3), Size::new(13, 4));
        fast.fill_solid(&area, BinaryColor::On).unwrap();
        slow.draw_iter(area.points().map(|p| Pixel(p, BinaryColor::On))).unwrap();
        assert!(fast.bits == slow.bits);
    }

    #[test]
    fn finds_the_window_that_changed() {
        let before = Frame::new();
        let mut after = Frame::new();
        assert_eq!(changed(&before.bits, &after.bits), None);
        after.draw_iter([Pixel(Point::new(13, 20), BinaryColor::On), Pixel(Point::new(30, 41), BinaryColor::On)]).unwrap();
        assert_eq!(changed(&before.bits, &after.bits), Some(Window { x: 8, y: 20, width: 24, height: 22 }));
        let window = changed(&before.bits, &after.bits).unwrap();
        assert_eq!(window.bytes(&after.bits).count(), 3 * 22);
    }
}
