//! Item pictures at the definition they are drawn in. The site draws them 96 x 96 and sends
//! them as they are; where a screen has less room it shows them at half, 48 x 48, each pixel
//! from a 2 x 2 block, never magnified. Sites that predate 96 x 96 pictures send 24 x 24 ones,
//! which are doubled as a last resort.

/// Side of a picture as the site draws it.
pub const FULL: usize = 96;
/// Side where a screen shows it at half.
pub const HALF: usize = 48;
const SMALL: usize = 24;

const fn bytes(side: usize) -> usize {
    side * side / 8
}

/// A picture from the site (96 x 96, or 24 x 24 from an older site) as the screens draw it:
/// full and half. Anything else is blank.
pub fn pictures(raw: &[u8]) -> (Vec<u8>, Vec<u8>) {
    match raw.len() {
        n if n == bytes(FULL) => (raw.to_vec(), halve(raw, FULL)),
        n if n == bytes(SMALL) => {
            let half = double(raw, SMALL);
            let full = double(&half, HALF);
            (full, half)
        }
        _ => (vec![0; bytes(FULL)], vec![0; bytes(HALF)]),
    }
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
        assert_eq!(kept, full);
        assert_eq!(half.len(), bytes(HALF));
        assert!(ink(&half, HALF, 0, 0));
        assert!(!ink(&half, HALF, 1, 0), "one pixel of four is not enough");
    }

    #[test]
    fn an_old_small_picture_is_doubled_and_anything_else_is_blank() {
        let mut small = vec![0u8; bytes(SMALL)];
        set(&mut small, SMALL, 0, 0);
        let (full, half) = pictures(&small);
        assert_eq!(half.iter().map(|b| b.count_ones()).sum::<u32>(), 4);
        assert_eq!(full.iter().map(|b| b.count_ones()).sum::<u32>(), 16);
        assert_eq!(pictures(&[1, 2, 3]).0, vec![0; bytes(FULL)]);
    }
}
