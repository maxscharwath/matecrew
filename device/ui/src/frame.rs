//! The panel's pixels as the site stores them: 800 x 480, rows top to bottom,
//! 8 pixels per byte, most significant bit first, 1 = ink. The firmware sends
//! these bytes to the panel and the site mirrors them; the virtual device
//! draws them on a canvas.

use crate::{HEIGHT, WIDTH};
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::Rectangle};

pub const BYTES: usize = (WIDTH * HEIGHT / 8) as usize;
const ROW: usize = (WIDTH / 8) as usize;

/// Panel-sized allocation backed by the portable engine framebuffer.
pub struct Frame(device_engine::frame::Frame);
impl Default for Frame {
    fn default() -> Self {
        Self(device_engine::frame::Frame::new(WIDTH, HEIGHT).expect("valid panel dimensions"))
    }
}
impl Frame {
    pub fn new() -> Self {
        Self::default()
    }
}
impl std::ops::Deref for Frame {
    type Target = device_engine::frame::Frame;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl std::ops::DerefMut for Frame {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
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
    pub const FULL: Window = Window {
        x: 0,
        y: 0,
        width: WIDTH,
        height: HEIGHT,
    };

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
/// Pixels that turn between two frames.
pub fn flipped(before: &[u8], after: &[u8]) -> u32 {
    before.iter().zip(after).map(|(a, b)| (a ^ b).count_ones()).sum()
}

/// A refresh that turns this share of the panel (percent of its pixels) is a new screen, not an
/// update: a partial refresh would leave the old screen showing through, so it takes the fast
/// full one (a short flash). Updates turn well under 1 %, screen changes 7 to 26 %.
pub const NEW_SCREEN_PERCENT: u32 = 6;
/// What partial refreshes leave behind adds up: past this share of the panel since the last full
/// refresh, the next one is full.
pub const GHOST_PERCENT: u32 = 30;

/// `pixels` as a share of the panel, in percent.
pub fn share(pixels: u32) -> u32 {
    (u64::from(pixels) * 100 / u64::from(WIDTH * HEIGHT)) as u32
}

/// How to show `after` over `before`, given the pixels partial refreshes turned since the last
/// full one (`ghost`): nothing, a partial refresh of a window, or the fast full refresh.
pub fn refresh(before: &[u8], after: &[u8], ghost: u32) -> Refresh {
    let Some(window) = changed(before, after) else { return Refresh::None };
    let turned = flipped(before, after);
    if share(turned) >= NEW_SCREEN_PERCENT || share(ghost + turned) >= GHOST_PERCENT {
        Refresh::Full
    } else {
        Refresh::Partial { window, turned }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refresh {
    None,
    Partial { window: Window, turned: u32 },
    Full,
}

pub fn changed(before: &[u8], after: &[u8]) -> Option<Window> {
    let (mut x0, mut x1, mut y0, mut y1) = (usize::MAX, 0, usize::MAX, 0);
    for (y, (a, b)) in before.chunks(ROW).zip(after.chunks(ROW)).enumerate() {
        let Some(first) = a.iter().zip(b).position(|(p, q)| p != q) else {
            continue;
        };
        let last = ROW
            - 1
            - a.iter()
                .rev()
                .zip(b.iter().rev())
                .position(|(p, q)| p != q)
                .unwrap_or(0);
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
    fn draw_iter<I: IntoIterator<Item = Pixel<Self::Color>>>(
        &mut self,
        pixels: I,
    ) -> Result<(), Self::Error> {
        self.0.draw_iter(pixels)
    }
    fn fill_solid(&mut self, area: &Rectangle, color: Self::Color) -> Result<(), Self::Error> {
        self.0.fill_solid(area, color)
    }
    fn clear(&mut self, color: Self::Color) -> Result<(), Self::Error> {
        self.0.clear(color)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_screen_refreshes_in_full_an_update_partially() {
        let blank = vec![0u8; BYTES];
        let mut update = blank.clone();
        update[1000] = 0xFF; // 8 pixels: a digit changed
        assert!(matches!(refresh(&blank, &update, 0), Refresh::Partial { turned: 8, .. }));
        assert_eq!(refresh(&blank, &blank, 0), Refresh::None);
        let mut screen = blank.clone();
        screen[..BYTES / 10].fill(0xFF); // 10 % of the panel
        assert_eq!(refresh(&blank, &screen, 0), Refresh::Full);
        // Partial refreshes add up to a full one.
        let ghost = WIDTH * HEIGHT * 30 / 100;
        assert_eq!(refresh(&blank, &update, ghost), Refresh::Full);
    }

    #[test]
    fn packs_ink_msb_first() {
        let mut frame = Frame::new();
        frame
            .draw_iter([
                Pixel(Point::new(0, 0), BinaryColor::On),
                Pixel(Point::new(9, 0), BinaryColor::On),
            ])
            .unwrap();
        assert_eq!(frame.bits[0], 0x80);
        assert_eq!(frame.bits[1], 0x40);
        frame
            .draw_iter([
                Pixel(Point::new(0, 0), BinaryColor::Off),
                Pixel(Point::new(-1, 900), BinaryColor::On),
            ])
            .unwrap();
        assert_eq!(frame.bits[0], 0);
    }

    #[test]
    fn fills_like_pixels() {
        let (mut fast, mut slow) = (Frame::new(), Frame::new());
        let area = Rectangle::new(Point::new(5, 3), Size::new(13, 4));
        fast.fill_solid(&area, BinaryColor::On).unwrap();
        slow.draw_iter(area.points().map(|p| Pixel(p, BinaryColor::On)))
            .unwrap();
        assert!(fast.bits == slow.bits);
    }

    #[test]
    fn byte_fills_preserve_neighbour_bits_at_every_alignment_and_clip() {
        let (mut fast, mut slow) = (Frame::new(), Frame::new());
        // A nonuniform background reveals accidental writes outside the rectangle.
        for (i, byte) in fast.bits.iter_mut().enumerate() {
            *byte = (i as u8).wrapping_mul(37);
        }
        slow.bits.copy_from_slice(&fast.bits);
        for color in [BinaryColor::On, BinaryColor::Off] {
            for x in [-10, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 791, 798, 799, 800] {
                for width in [0, 1, 2, 7, 8, 9, 16, 31, 800] {
                    let area = Rectangle::new(Point::new(x, 478), Size::new(width, 5));
                    fast.fill_solid(&area, color).unwrap();
                    slow.draw_iter(area.points().map(|p| Pixel(p, color)))
                        .unwrap();
                    assert!(
                        fast.bits == slow.bits,
                        "x={x}, width={width}, color={color:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn finds_the_window_that_changed() {
        let before = Frame::new();
        let mut after = Frame::new();
        assert_eq!(changed(&before.bits, &after.bits), None);
        after
            .draw_iter([
                Pixel(Point::new(13, 20), BinaryColor::On),
                Pixel(Point::new(30, 41), BinaryColor::On),
            ])
            .unwrap();
        assert_eq!(
            changed(&before.bits, &after.bits),
            Some(Window {
                x: 8,
                y: 20,
                width: 24,
                height: 22
            })
        );
        let window = changed(&before.bits, &after.bits).unwrap();
        assert_eq!(window.bytes(&after.bits).count(), 3 * 22);
    }
}
