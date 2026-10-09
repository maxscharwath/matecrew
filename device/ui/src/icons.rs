//! Pixel icons drawn for this terminal, one string per row, `#` for ink.

use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::Rectangle};

pub struct Icon(&'static [&'static str]);

impl Icon {
    pub fn width(&self) -> i32 {
        self.0.first().map_or(0, |row| row.len() as i32)
    }

    pub fn draw<D>(&self, d: &mut D, at: Point) -> Result<(), D::Error>
    where
        D: DrawTarget<Color = BinaryColor>,
    {
        self.draw_colored(d, at, BinaryColor::On)
    }

    pub fn draw_colored<D>(&self, d: &mut D, at: Point, color: BinaryColor) -> Result<(), D::Error>
    where
        D: DrawTarget<Color = BinaryColor>,
    {
        d.draw_iter(self.0.iter().enumerate().flat_map(move |(y, row)| {
            row.bytes()
                .enumerate()
                .filter(|(_, c)| *c == b'#')
                .map(move |(x, _)| Pixel(at + Point::new(x as i32, y as i32), color))
        }))
    }
}

pub const ARROW_DOWN: Icon = Icon(&[
    "#####",
    ".###.",
    "..#..",
]);

pub const CHECK: Icon = Icon(&[
    "......########......",
    "....##........##....",
    "...#............#...",
    "..#..............#..",
    ".#..........##....#.",
    ".#.........##.....#.",
    "#.........##.......#",
    "#........##........#",
    "#..##...##.........#",
    "#...##.##..........#",
    "#....###...........#",
    "#.....#............#",
    ".#................#.",
    ".#................#.",
    "..#..............#..",
    "...#............#...",
    "....##........##....",
    "......########......",
]);

/// A card with the waves of a reader, for "put your badge here".
pub const BADGE: Icon = Icon(&[
    ".................................##.....",
    "..................................##....",
    ".######################............##...",
    "#......................#.......#....#...",
    "#......................#.......##...##..",
    "#......................#........##...#..",
    "#..#######.............#....##...#...#..",
    "#..#.....#..#########..#.....#...##...#.",
    "#..#.###.#.............#.....##...#...#.",
    "#..#..#..#.............#......#...#...#.",
    "#..#..#..#..#######....#......#...#...#.",
    "#..#.###.#.............#......#...#...#.",
    "#..#.....#.............#.....##...#...#.",
    "#..#######..########...#.....#...##...#.",
    "#......................#....##...#...#..",
    "#......................#........##...#..",
    "#......................#.......##...##..",
    "#......................#.......#....#...",
    ".######################............##...",
    "..................................##....",
    ".................................##.....",
]);

pub const WARNING: Icon = Icon(&[
    ".........##.........",
    "........#..#........",
    "........#..#........",
    ".......#....#.......",
    ".......#.##.#.......",
    "......#..##..#......",
    "......#..##..#......",
    ".....#...##...#.....",
    ".....#...##...#.....",
    "....#....##....#....",
    "....#..........#....",
    "...#.....##.....#...",
    "...#.....##.....#...",
    "..#..............#..",
    "..################..",
]);

pub const WIFI_BIG: Icon = Icon(&[
    ".....##########.....",
    "...##..........##...",
    ".##..............##.",
    "#....##########....#",
    "...##..........##...",
    "..#..............#..",
    "......########......",
    ".....#........#.....",
    "....#..........#....",
    "........####........",
    ".......#....#.......",
    ".........##.........",
    ".........##.........",
]);

const WIFI_BARS: [(i32, i32); 3] = [(0, 2), (3, 4), (6, 6)];

pub fn wifi_width() -> i32 {
    8
}

/// Three bars, filled up to `bars`, outlined above it.
pub fn draw_wifi<D>(d: &mut D, at: Point, bars: u8) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    for (i, (x, height)) in WIFI_BARS.iter().enumerate() {
        let rect = Rectangle::new(at + Point::new(*x, 7 - height), Size::new(2, *height as u32));
        if (i as u8) < bars {
            d.fill_solid(&rect, BinaryColor::On)?;
        } else {
            d.fill_solid(&Rectangle::new(rect.top_left + Point::new(0, height - 1), Size::new(2, 1)), BinaryColor::On)?;
        }
    }
    Ok(())
}

pub fn battery_width() -> i32 {
    14
}

/// Outlined cell with a nub, filled in proportion to `charge` (0 to 100).
pub fn draw_battery<D>(d: &mut D, at: Point, charge: u8) -> Result<(), D::Error>
where
    D: DrawTarget<Color = BinaryColor>,
{
    use embedded_graphics::primitives::PrimitiveStyle;
    Rectangle::new(at, Size::new(12, 7))
        .into_styled(PrimitiveStyle::with_stroke(BinaryColor::On, 1))
        .draw(d)?;
    d.fill_solid(&Rectangle::new(at + Point::new(12, 2), Size::new(2, 3)), BinaryColor::On)?;
    let fill = (u32::from(charge.min(100)) * 8 + 50) / 100;
    d.fill_solid(&Rectangle::new(at + Point::new(2, 2), Size::new(fill, 3)), BinaryColor::On)
}
