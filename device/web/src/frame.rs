//! The panel as the site stores it: 800 x 480, rows top to bottom, 8 pixels
//! per byte, most significant bit first, 1 = ink.

use embedded_graphics::{pixelcolor::BinaryColor, prelude::*};
use matecrew_ui::{HEIGHT, WIDTH};

pub const BYTES: usize = (WIDTH * HEIGHT / 8) as usize;

pub struct Frame {
    pub bits: Vec<u8>,
}

impl Frame {
    pub fn new() -> Self {
        Self { bits: vec![0; BYTES] }
    }
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
}
