//! Item pictures at the definition they are drawn in. The site draws them 96 x 96 and sends
//! them as they are; where a screen has less room it shows them at half, 48 x 48, each pixel
//! from a 2 x 2 block, never magnified. Sites that predate 96 x 96 pictures send 24 x 24 ones,
//! which are doubled as a last resort.
//!
//! A picture carries a second plane, its opacity (`engine::sprite::PackedSprite`): ink is
//! black, opaque paper white, the rest transparent. The site sends it; a picture without one
//! gets it here the same way (the paper reachable from the edges is transparent). Both planes
//! are halved alike.

/// Side of a picture as the site draws it.
pub const FULL: usize = 96;
/// Side where a screen shows it at half.
pub const HALF: usize = 48;
const SMALL: usize = 24;

const fn bytes(side: usize) -> usize {
    side * side / 8
}

/// A picture from the site (96 x 96 with or without its opacity plane, or 24 x 24 from an
/// older site) as the screens draw it: full and half. Anything else is blank.
pub fn pictures(raw: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let plane = bytes(FULL);
    match raw.len() {
        n if n == 2 * plane => {
            let mut half = halve(&raw[..plane], FULL);
            half.extend(halve(&raw[plane..], FULL));
            (raw.to_vec(), half)
        }
        n if n == plane => (with_opacity(raw, FULL), with_opacity(&halve(raw, FULL), HALF)),
        n if n == bytes(SMALL) => {
            let half = double(raw, SMALL);
            let full = double(&half, HALF);
            (with_opacity(&full, FULL), with_opacity(&half, HALF))
        }
        _ => (vec![0; bytes(FULL)], vec![0; bytes(HALF)]),
    }
}

/// `bits` followed by its opacity plane: everything but the paper reachable from the edges
/// without crossing ink.
fn with_opacity(bits: &[u8], side: usize) -> Vec<u8> {
    let mut outside = vec![false; side * side];
    let mut stack = Vec::new();
    let reach = |x: usize, y: usize, outside: &mut Vec<bool>, stack: &mut Vec<(usize, usize)>| {
        if !outside[y * side + x] && !ink(bits, side, x, y) {
            outside[y * side + x] = true;
            stack.push((x, y));
        }
    };
    for i in 0..side {
        for (x, y) in [(i, 0), (i, side - 1), (0, i), (side - 1, i)] {
            reach(x, y, &mut outside, &mut stack);
        }
    }
    while let Some((x, y)) = stack.pop() {
        if x > 0 {
            reach(x - 1, y, &mut outside, &mut stack);
        }
        if x + 1 < side {
            reach(x + 1, y, &mut outside, &mut stack);
        }
        if y > 0 {
            reach(x, y - 1, &mut outside, &mut stack);
        }
        if y + 1 < side {
            reach(x, y + 1, &mut outside, &mut stack);
        }
    }
    let mut planes = bits.to_vec();
    planes.resize(2 * bytes(side), 0);
    let mut mask = vec![0u8; bytes(side)];
    for y in 0..side {
        for x in 0..side {
            if !outside[y * side + x] {
                set(&mut mask, side, x, y);
            }
        }
    }
    planes[bytes(side)..].copy_from_slice(&mask);
    planes
}

fn ink(bits: &[u8], side: usize, x: usize, y: usize) -> bool {
    bits[y * side / 8 + x / 8] & (0x80 >> (x % 8)) != 0
}

fn set(bits: &mut [u8], side: usize, x: usize, y: usize) {
    bits[y * side / 8 + x / 8] |= 0x80 >> (x % 8);
}

/// Half the side: a pixel is ink when at least two of its 2 x 2 block are.
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

/// Twice the side: each pixel becomes 2 x 2.
fn double(bits: &[u8], side: usize) -> Vec<u8> {
    let twice = side * 2;
    let mut out = vec![0; bytes(twice)];
    for y in 0..twice {
        for x in 0..twice {
            if ink(bits, side, x / 2, y / 2) {
                set(&mut out, twice, x, y);
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
        let mut full = vec![0u8; bytes(FULL)];
        // A 2 x 2 block at the top left, and one lone pixel beside it.
        set(&mut full, FULL, 0, 0);
        set(&mut full, FULL, 1, 0);
        set(&mut full, FULL, 0, 1);
        set(&mut full, FULL, 1, 1);
        set(&mut full, FULL, 3, 0);
        let (kept, half) = pictures(&full);
        assert_eq!(&kept[..bytes(FULL)], &full[..]);
        assert_eq!(half.len(), 2 * bytes(HALF));
        assert!(ink(&half, HALF, 0, 0));
        assert!(!ink(&half, HALF, 1, 0), "one pixel of four is not enough");
    }

    #[test]
    fn paper_enclosed_by_ink_is_opaque_and_the_rest_transparent() {
        let mut ring = vec![0u8; bytes(HALF)];
        for i in 10..=20 {
            for (x, y) in [(i, 10), (i, 20), (10, i), (20, i)] {
                set(&mut ring, HALF, x, y);
            }
        }
        let planes = with_opacity(&ring, HALF);
        let mask = &planes[bytes(HALF)..];
        assert!(ink(mask, HALF, 15, 15), "inside: white");
        assert!(!ink(mask, HALF, 0, 0), "around: transparent");
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
    fn an_old_small_picture_is_doubled_and_anything_else_is_blank() {
        let mut small = vec![0u8; bytes(SMALL)];
        set(&mut small, SMALL, 0, 0);
        let (full, half) = pictures(&small);
        assert_eq!(half[..bytes(HALF)].iter().map(|b| b.count_ones()).sum::<u32>(), 4);
        assert_eq!(full[..bytes(FULL)].iter().map(|b| b.count_ones()).sum::<u32>(), 16);
        assert_eq!(pictures(&[1, 2, 3]).0, vec![0; bytes(FULL)]);
    }
}
