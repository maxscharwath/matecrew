//! Portable MSB-first 1-bit framebuffer, with byte-aligned rows and configurable dimensions.

use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::Rectangle};

/// Runtime-sized, row-aligned packed framebuffer. One bits-per-byte format on every device.
pub struct Frame {
    pub bits: Vec<u8>,
    width: u32,
    height: u32,
    row: usize,
}
impl Frame {
    /// Row stride, including padding when width is not divisible by eight.
    pub fn row_bytes(&self) -> usize {
        self.row
    }
    pub fn new(width: u32, height: u32) -> Option<Self> {
        if width == 0 || height == 0 {
            return None;
        }
        let row = (width as usize).checked_add(7)? / 8;
        let bytes = row.checked_mul(height as usize)?;
        if bytes > 16 * 1024 * 1024 {
            return None;
        }
        Some(Self {
            bits: vec![0; bytes],
            width,
            height,
            row,
        })
    }
}

impl OriginDimensions for Frame {
    fn size(&self) -> Size {
        Size::new(self.width, self.height)
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
            let (Ok(x), Ok(y)) = (u32::try_from(point.x), u32::try_from(point.y)) else {
                continue;
            };
            if x >= self.width || y >= self.height {
                continue;
            }
            let i = y as usize * self.row + (x as usize >> 3);
            let mask = 0x80 >> (x & 7);
            if color.is_on() {
                self.bits[i] |= mask;
            } else {
                self.bits[i] &= !mask;
            }
        }
        Ok(())
    }

    /// Whole rows of bytes at once where the area allows it: most of what the
    /// screens draw is 4 x 4 blocks of the pixel-art canvas.
    fn fill_solid(&mut self, area: &Rectangle, color: Self::Color) -> Result<(), Self::Error> {
        let area = area.intersection(&self.bounding_box());
        let Some(bottom_right) = area.bottom_right() else {
            return Ok(());
        };
        let (left, right) = (area.top_left.x as usize, bottom_right.x as usize);
        let (first, last) = (left >> 3, right >> 3);
        let start_mask = 0xffu8 >> (left & 7);
        let end_mask = 0xffu8 << (7 - (right & 7));
        let update = |byte: &mut u8, mask: u8| {
            if color.is_on() {
                *byte |= mask;
            } else {
                *byte &= !mask;
            }
        };
        for y in area.top_left.y as usize..=bottom_right.y as usize {
            let row = &mut self.bits[y * self.row..(y + 1) * self.row];
            if first == last {
                update(&mut row[first], start_mask & end_mask);
            } else {
                update(&mut row[first], start_mask);
                row[first + 1..last].fill(if color.is_on() { 0xff } else { 0 });
                update(&mut row[last], end_mask);
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
    fn supports_different_panels_and_non_byte_aligned_rows() {
        let mut frame = Frame::new(13, 7).unwrap();
        frame
            .draw_iter([Pixel(Point::new(12, 1), BinaryColor::On)])
            .unwrap();
        assert_eq!(frame.bits[3], 0x08);
        assert_eq!(frame.bits.len(), 14);
        assert!(Frame::new(u32::MAX, u32::MAX).is_none());
        let area = Rectangle::new(Point::new(3, 2), Size::new(20, 10));
        frame.fill_solid(&area, BinaryColor::On).unwrap();
        let mut slow = Frame::new(13, 7).unwrap();
        slow.draw_iter([Pixel(Point::new(12, 1), BinaryColor::On)])
            .unwrap();
        slow.draw_iter(area.points().map(|p| Pixel(p, BinaryColor::On)))
            .unwrap();
        assert!(frame.bits == slow.bits);
    }
}
