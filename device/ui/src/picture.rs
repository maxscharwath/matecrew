//! Item pictures at the definition they are drawn in. The site draws them 96 x 96 and sends
//! them as they are; where a screen has less room it shows them at half, 48 x 48, each pixel
//! from a 2 x 2 block, never magnified. A photo comes dithered: its half is dithered again from
//! the blocks' grey, so it keeps its tones instead of darkening.
//!
//! A picture carries a second plane, its opacity (`engine::sprite::PackedSprite`): ink is
//! black, opaque paper white, the rest transparent. The site computes it
//! (`src/lib/device/bitmap.ts`, `withOpacity`).
//!
//! People's avatars come at the side their screen draws them (`contract::AVATAR_*`), already
//! in a disc: [`avatar`] only checks them.

/// Side of a picture as the site draws it.
pub const FULL: usize = 96;
/// Side where a screen shows it at half.
pub const HALF: usize = 48;

const fn bytes(side: usize) -> usize {
    side * side / 8
}

/// A picture from the site (96 x 96 and its opacity plane) as the screens draw it: full and
/// half. Anything else is blank.
pub fn pictures(raw: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let plane = bytes(FULL);
    if raw.len() != 2 * plane {
        return (vec![0; plane], vec![0; bytes(HALF)]);
    }
    let mut half = halve_ink(&raw[..plane], FULL);
    half.extend(halve(&raw[plane..], FULL));
    (raw.to_vec(), half)
}

/// An avatar from the site at `side` x `side` with its opacity plane, as the screens draw it;
/// empty when there is none or it has another size: the screen then shows the initials or an
/// icon.
pub fn avatar(raw: Option<&[u8]>, side: usize) -> Vec<u8> {
    raw.filter(|raw| raw.len() == 2 * bytes(side)).map(<[u8]>::to_vec).unwrap_or_default()
}

fn ink(bits: &[u8], side: usize, x: usize, y: usize) -> bool {
    bits[y * side / 8 + x / 8] & (0x80 >> (x % 8)) != 0
}

fn set(bits: &mut [u8], side: usize, x: usize, y: usize) {
    bits[y * side / 8 + x / 8] |= 0x80 >> (x % 8);
}

/// Where Atkinson dithering passes a pixel's error: an eighth to each of these neighbours, as
/// the site dithers (`src/lib/device/bitmap.ts`).
const ATKINSON: [(isize, usize); 6] = [(1, 0), (2, 0), (-1, 1), (0, 1), (1, 1), (0, 2)];

/// Half the side of the ink: each 2 x 2 block as a grey (0 to 4 pixels of ink), dithered. A
/// block all ink or all paper stays so, and two pixels of four are ink as in [`halve`]: drawings
/// and pixel art keep their look, a dithered photo its tones.
fn halve_ink(bits: &[u8], side: usize) -> Vec<u8> {
    let half = side / 2;
    let mut level = vec![0f32; half * half];
    for y in 0..half {
        for x in 0..half {
            let inked = [(0, 0), (1, 0), (0, 1), (1, 1)]
                .iter()
                .filter(|(dx, dy)| ink(bits, side, 2 * x + dx, 2 * y + dy))
                .count();
            level[y * half + x] = 255.0 * (4 - inked) as f32 / 4.0;
        }
    }
    let mut out = vec![0; bytes(half)];
    for y in 0..half {
        for x in 0..half {
            let old = level[y * half + x];
            let inked = old < 128.0;
            if inked {
                set(&mut out, half, x, y);
            }
            let error = (old - if inked { 0.0 } else { 255.0 }) / 8.0;
            for (dx, dy) in ATKINSON {
                let (nx, ny) = (x as isize + dx, y + dy);
                if nx >= 0 && (nx as usize) < half && ny < half {
                    level[ny * half + nx as usize] += error;
                }
            }
        }
    }
    out
}

/// Half the side of the opacity: a pixel is opaque when at least two of its 2 x 2 block are.
fn halve(bits: &[u8], side: usize) -> Vec<u8> {
    let half = side / 2;
    let mut out = vec![0; bytes(half)];
    for y in 0..half {
        for x in 0..half {
            let inked = [(0, 0), (1, 0), (0, 1), (1, 1)]
                .iter()
                .filter(|(dx, dy)| ink(bits, side, 2 * x + dx, 2 * y + dy))
                .count();
            if inked >= 2 {
                set(&mut out, half, x, y);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_picture_is_kept_and_halved_by_blocks() {
        let mut raw = vec![0u8; 2 * bytes(FULL)];
        // A 2 x 2 block at the top left, and one lone pixel beside it.
        set(&mut raw, FULL, 0, 0);
        set(&mut raw, FULL, 1, 0);
        set(&mut raw, FULL, 0, 1);
        set(&mut raw, FULL, 1, 1);
        set(&mut raw, FULL, 3, 0);
        let (kept, half) = pictures(&raw);
        assert_eq!(kept, raw);
        assert_eq!(half.len(), 2 * bytes(HALF));
        assert!(ink(&half, HALF, 0, 0));
        assert!(!ink(&half, HALF, 1, 0), "one pixel of four is not enough");
    }

    #[test]
    fn a_dithered_grey_keeps_its_tone_at_half() {
        let mut raw = vec![0u8; 2 * bytes(FULL)];
        // A checkerboard: 50 % ink, as dithering draws a mid grey.
        for y in 0..FULL {
            for x in (y % 2..FULL).step_by(2) {
                set(&mut raw, FULL, x, y);
            }
        }
        let (_, half) = pictures(&raw);
        let inked = (0..HALF * HALF).filter(|i| ink(&half, HALF, i % HALF, i / HALF)).count();
        let share = inked as f32 / (HALF * HALF) as f32;
        assert!((0.4..0.6).contains(&share), "{share}: a mid grey, not black");
    }

    #[test]
    fn an_avatar_comes_at_its_side_or_not_at_all() {
        let raw = vec![0xAA; 2 * bytes(40)];
        assert_eq!(avatar(Some(&raw), 40), raw);
        assert!(avatar(Some(&raw), 32).is_empty(), "another side");
        assert!(avatar(None, 40).is_empty());
    }

    #[test]
    fn the_opacity_plane_is_halved_with_the_ink() {
        let plane = bytes(FULL);
        let mut raw = vec![0u8; 2 * plane];
        raw[plane..].fill(0xFF); // opaque everywhere
        let (full, half) = pictures(&raw);
        assert_eq!(full.len(), 2 * plane);
        assert_eq!(half.len(), 2 * bytes(HALF));
        assert!(half[bytes(HALF)..].iter().all(|b| *b == 0xFF));
    }

    #[test]
    fn anything_else_is_blank() {
        let blank = (vec![0; bytes(FULL)], vec![0; bytes(HALF)]);
        assert_eq!(pictures(&[1, 2, 3]), blank);
        assert_eq!(pictures(&vec![0xFF; bytes(FULL)]), blank, "an ink plane without its opacity");
        assert_eq!(pictures(&[]), blank);
    }
}
