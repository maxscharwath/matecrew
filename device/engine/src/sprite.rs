//! Packed 1-bit sprites on any target, using horizontal spans instead of one fill per pixel.
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::Rectangle};

/// MSB-first, tightly packed rows. Set bits draw ink; unset bits are transparent or paper.
///
/// Three colours: a second plane of the same size after the first is the sprite's opacity.
/// A pixel without ink paints paper where it is set, and lets what is under it show where it
/// is not: the white body of a can stays white on a grey disc, the space around it shows the
/// disc. Without the plane, paper is as the caller says.
pub struct PackedSprite<'a> {
    bits: &'a [u8],
    mask: Option<&'a [u8]>,
    size: Size,
}
impl<'a> PackedSprite<'a> {
    /// Rejects empty dimensions, arithmetic overflow and truncated assets. Twice the bytes of
    /// one plane carry the opacity plane too.
    pub fn new(bits: &'a [u8], size: Size) -> Option<Self> {
        if size.width == 0 || size.height == 0 {
            return None;
        }
        let pixels = (size.width as usize).checked_mul(size.height as usize)?;
        let bytes = pixels.checked_add(7)? / 8;
        if bits.len() < bytes {
            return None;
        }
        let mask = (bits.len() >= 2 * bytes).then(|| &bits[bytes..2 * bytes]);
        Some(Self { bits: &bits[..bytes], mask, size })
    }

    /// The colour pixel `i` paints, if any.
    fn paint(&self, i: usize, ink: BinaryColor, paper: Option<BinaryColor>) -> Option<BinaryColor> {
        let set = |plane: &[u8]| plane[i >> 3] & (0x80 >> (i & 7)) != 0;
        if set(self.bits) {
            Some(ink)
        } else if let Some(mask) = self.mask {
            set(mask).then(|| ink.invert())
        } else {
            paper
        }
    }

    /// Draw with integer scaling, optional opaque background, and the target's clipping.
    /// Zero scale or coordinates whose rectangle would overflow are a no-op.
    pub fn draw<D: DrawTarget<Color = BinaryColor>>(
        &self,
        target: &mut D,
        at: Point,
        scale: u32,
        ink: BinaryColor,
        paper: Option<BinaryColor>,
    ) -> Result<(), D::Error> {
        let Some((width, height)) = self
            .size
            .width
            .checked_mul(scale)
            .zip(self.size.height.checked_mul(scale))
        else {
            return Ok(());
        };
        if width == 0
            || height == 0
            || width > i32::MAX as u32
            || height > i32::MAX as u32
            || at.x.checked_add(width as i32 - 1).is_none()
            || at.y.checked_add(height as i32 - 1).is_none()
        {
            return Ok(());
        }
        for y in 0..self.size.height {
            let color_at = |x: u32| self.paint(y as usize * self.size.width as usize + x as usize, ink, paper);
            let mut x = 0;
            while x < self.size.width {
                let start = x;
                let color = color_at(x);
                x += 1;
                while x < self.size.width && color_at(x) == color {
                    x += 1;
                }
                let Some(color) = color else {
                    continue;
                };
                target.fill_solid(
                    &Rectangle::new(
                        at + Point::new((start * scale) as i32, (y * scale) as i32),
                        Size::new((x - start) * scale, scale),
                    ),
                    color,
                )?;
            }
        }
        Ok(())
    }
}

impl PackedSprite<'_> {
    /// Nearest-neighbour fitting keeps 1-bit assets crisp at smaller or larger logical sizes.
    pub fn draw_resized<D: DrawTarget<Color = BinaryColor>>(
        &self,
        target: &mut D,
        at: Point,
        size: Size,
        ink: BinaryColor,
        paper: Option<BinaryColor>,
    ) -> Result<(), D::Error> {
        if size.width == 0 || size.height == 0 || size.width > 4096 || size.height > 4096 {
            return Ok(());
        }
        let color_at = |x: u32, y: u32| {
            let sx = (x as u64 * self.size.width as u64 / size.width as u64) as u32;
            let sy = (y as u64 * self.size.height as u64 / size.height as u64) as u32;
            self.paint(sy as usize * self.size.width as usize + sx as usize, ink, paper)
        };
        for y in 0..size.height {
            let mut x = 0;
            while x < size.width {
                let start = x;
                let color = color_at(x, y);
                x += 1;
                while x < size.width && color_at(x, y) == color {
                    x += 1;
                }
                if let Some(color) = color {
                    target.fill_solid(
                        &Rectangle::new(
                            at + Point::new(start as i32, y as i32),
                            Size::new(x - start, 1),
                        ),
                        color,
                    )?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::Frame;
    #[test]
    fn spans_match_pixels_for_scaling_transparency_inversion_and_clipping() {
        for size in [Size::new(1, 1), Size::new(7, 3), Size::new(24, 24)] {
            let bits: Vec<u8> = (0..(size.width * size.height).div_ceil(8))
                .map(|i| (i as u8).wrapping_mul(37) ^ 0xa5)
                .collect();
            let sprite = PackedSprite::new(&bits, size).unwrap();
            for scale in [1, 2, 4] {
                for at in [Point::new(-3, -2), Point::new(5, 7), Point::new(790, 475)] {
                    for (ink, paper) in [
                        (BinaryColor::On, None),
                        (BinaryColor::On, Some(BinaryColor::Off)),
                        (BinaryColor::Off, Some(BinaryColor::On)),
                    ] {
                        let (mut fast, mut reference) =
                            (Frame::new(800, 480).unwrap(), Frame::new(800, 480).unwrap());
                        fast.bits.fill(0x69);
                        reference.bits.fill(0x69);
                        sprite.draw(&mut fast, at, scale, ink, paper).unwrap();
                        for y in 0..size.height {
                            for x in 0..size.width {
                                let i = (y * size.width + x) as usize;
                                let color = if bits[i >> 3] & (0x80 >> (i & 7)) != 0 {
                                    Some(ink)
                                } else {
                                    paper
                                };
                                if let Some(color) = color {
                                    let block = Rectangle::new(
                                        at + Point::new((x * scale) as i32, (y * scale) as i32),
                                        Size::new(scale, scale),
                                    );
                                    reference
                                        .draw_iter(block.points().map(|p| Pixel(p, color)))
                                        .unwrap();
                                }
                            }
                        }
                        assert!(fast.bits == reference.bits);
                    }
                }
            }
        }
    }
    #[test]
    fn an_opacity_plane_paints_paper_where_set_and_nothing_elsewhere() {
        // 8 x 1: ink, opaque paper, then transparent pixels.
        let bits = [0b1000_0000, 0b1100_0000];
        let sprite = PackedSprite::new(&bits, Size::new(8, 1)).unwrap();
        let mut frame = Frame::new(800, 480).unwrap();
        frame.bits.fill(0xFF);
        // The caller's paper is ignored: the plane decides.
        sprite.draw_resized(&mut frame, Point::zero(), Size::new(8, 1), BinaryColor::On, Some(BinaryColor::Off)).unwrap();
        assert_eq!(frame.bits[0], 0b1011_1111, "ink, paper, then the ink already there");
        assert!(PackedSprite::new(&bits[..1], Size::new(8, 1)).unwrap().mask.is_none());
    }

    #[test]
    fn invalid_assets_and_overflowing_footprints_do_not_draw() {
        assert!(PackedSprite::new(&[], Size::new(24, 24)).is_none());
        assert!(PackedSprite::new(&[0xff], Size::zero()).is_none());
        let sprite = PackedSprite::new(&[0xff], Size::new(2, 2)).unwrap();
        let mut frame = Frame::new(800, 480).unwrap();
        for (at, scale) in [
            (Point::zero(), 0),
            (Point::zero(), u32::MAX),
            (Point::new(i32::MAX, i32::MAX), 4),
        ] {
            sprite
                .draw(&mut frame, at, scale, BinaryColor::On, None)
                .unwrap();
        }
        assert!(frame.bits.iter().all(|&b| b == 0));
    }
}
