//! Cartesian charts share one data domain and a bounded number of samples/series.
use super::{ChartSeries, Font};
use crate::{text, theme::Theme};
use embedded_graphics::{
    pixelcolor::BinaryColor,
    prelude::*,
    primitives::{Line, PrimitiveStyle, Rectangle},
};
use serde_json::Value;
use u8g2_fonts::types::HorizontalAlignment;

pub(super) struct Chart<'a> {
    pub data: &'a Value,
    pub max: &'a Value,
    pub series: &'a [ChartSeries],
    pub x_key: &'a str,
    pub axes: bool,
    pub grid: bool,
    pub legend: bool,
    pub stacked: bool,
}
/// Native tones of stacked bar series, bottom first.
const STACK_TONES: [u8; 4] = [100, 50, 25, 12];
fn patterned<D: DrawTarget<Color = BinaryColor>>(
    target: &mut D,
    a: Point,
    b: Point,
    stroke: u8,
) -> Result<(), D::Error> {
    thick(target, a, b, stroke, 1)
}
/// A line `weight` pixels wide; dots and dashes follow its major axis so thick dashes stay square.
pub(super) fn thick<D: DrawTarget<Color = BinaryColor>>(
    target: &mut D,
    a: Point,
    b: Point,
    stroke: u8,
    weight: u32,
) -> Result<(), D::Error> {
    let horizontal = (b.x - a.x).abs() >= (b.y - a.y).abs();
    let w = weight.max(1) as i32;
    target.draw_iter(
        Line::new(a, b)
            .into_styled(PrimitiveStyle::with_stroke(BinaryColor::On, weight.max(1)))
            .pixels()
            .filter(move |Pixel(p, _)| {
                let step = if horizontal { p.x - a.x } else { p.y - a.y }.abs();
                match stroke {
                    1 => step % (3 * w) < w,
                    2 => step % (6 * w) < 3 * w,
                    _ => true,
                }
            }),
    )
}
/// Ordered-dither coverage, as surfaces use: `tone` percent of ink.
pub(super) fn toned(p: Point, tone: u8) -> bool {
    const BAYER: [[u8; 4]; 4] = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    (BAYER[p.y.rem_euclid(4) as usize][p.x.rem_euclid(4) as usize] as u16 * 100 + 50) < tone as u16 * 16
}
/// Chart geometry per theme: native themes get 2 px lines, real margins and dithered greys.
struct Look {
    native: bool,
    weight: u32,
    left: u32,
    legend: u32,
    bottom: u32,
}
impl Look {
    fn of(theme: Theme) -> Self {
        if matches!(theme, Theme::Paper | Theme::Dark) {
            Self { native: true, weight: 2, left: 40, legend: 30, bottom: 28 }
        } else {
            Self { native: false, weight: 1, left: 25, legend: 13, bottom: 13 }
        }
    }
}
fn number(value: f64) -> String {
    if value >= 1_000_000.0 {
        format!("{:.0}m", value / 1_000_000.0)
    } else if value >= 1000.0 {
        format!("{:.0}k", value / 1000.0)
    } else if value > 0.0 && value < 1.0 {
        format!("{value:.1}")
    } else {
        format!("{value:.0}")
    }
}
impl Chart<'_> {
    pub(super) fn draw<D: DrawTarget<Color = BinaryColor>>(
        &self,
        target: &mut D,
        area: Rectangle,
        theme: Theme,
    ) -> Result<(), D::Error> {
        let rows = self.data.as_array().map(Vec::as_slice).unwrap_or_default();
        let rows = &rows[..rows.len().min(64)];
        let sample = |row: &Value, series: &ChartSeries| {
            row.get(&series.data_key)
                .and_then(Value::as_f64)
                .filter(|v| v.is_finite() && *v >= 0.0)
        };
        let maximum = self
            .max
            .as_f64()
            .filter(|v| v.is_finite() && *v > 0.0)
            .unwrap_or_else(|| {
                rows.iter()
                    .map(|row| {
                        // A stack reaches the sum of its bars.
                        let stack: f64 = if self.stacked {
                            self.series.iter().filter(|s| s.style == 1).filter_map(|s| sample(row, s)).sum()
                        } else {
                            0.0
                        };
                        self.series.iter().filter_map(|s| sample(row, s)).fold(stack, f64::max)
                    })
                    .fold(1.0, f64::max)
            });
        let look = Look::of(theme);
        let label_axes = self.axes && area.size.width >= 72 && area.size.height >= 40;
        let left = if label_axes { look.left } else { 1 };
        let top = if self.legend { look.legend } else { 1 };
        let bottom = if label_axes && !self.x_key.is_empty() {
            look.bottom
        } else {
            look.weight + 1
        };
        // Native labels sit on their grid line, centred on the font's figure height.
        let figure = if look.native { 7 } else { 8 };
        let width = area.size.width.saturating_sub(left + 2) as i32;
        let height = area.size.height.saturating_sub(top + bottom) as i32;
        if width < 2 || height < 2 {
            return Ok(());
        }
        let origin = area.top_left + Point::new(left as i32, top as i32);
        let base = origin.y + height - 1;
        let font = theme.font(Font::Caption);
        if self.grid {
            for i in 0..=2 {
                let y = origin.y + i * (height - 1) / 2;
                patterned(
                    target,
                    Point::new(origin.x, y),
                    Point::new(origin.x + width - 1, y),
                    1,
                )?;
            }
        }
        if self.axes {
            patterned(target, origin, Point::new(origin.x, base), 0)?;
            patterned(
                target,
                Point::new(origin.x, base),
                Point::new(origin.x + width - 1, base),
                0,
            )?;
        }
        if label_axes {
            let low = if look.native { base + figure } else { base };
            for (value, y) in [(maximum, origin.y + figure), (0.0, low)] {
                text::label(
                    target,
                    font,
                    &number(value),
                    Point::new(origin.x - if look.native { 10 } else { 3 }, y),
                    left as i32 - 4,
                    BinaryColor::On,
                    HorizontalAlignment::Right,
                )?;
            }
        }
        let n = rows.len();
        let bars = self.series.iter().filter(|s| s.style == 1).count().max(1) as i32;
        let mut bar_index = 0;
        // Stacked: each category's height so far, and where a value lands.
        let mut stacks = vec![0.0f64; n];
        let level = |value: f64| base - (value.min(maximum) / maximum * (height - 1) as f64) as i32;
        let columns = if self.stacked { 1 } else { bars };
        for (index, series) in self.series.iter().enumerate() {
            if self.legend {
                let slot = area.size.width as i32 / self.series.len() as i32;
                let x = area.top_left.x + index as i32 * slot;
                let (swatch, gap, mid, baseline) = if look.native { (20, 28, 10, 15) } else { (8, 11, 5, 9) };
                let y = area.top_left.y + mid;
                if series.style == 0 || !look.native {
                    thick(target, Point::new(x, y), Point::new(x + swatch, y), series.stroke, look.weight)?;
                } else {
                    // Bars and areas show their fill.
                    let tone = match series.style {
                        1 if self.stacked => STACK_TONES[(bar_index as usize).min(3)],
                        1 => [100, 50, 25][usize::from(series.stroke.min(2))],
                        _ => 35,
                    };
                    let r = Rectangle::new(Point::new(x, y - 6), Size::new(swatch as u32, 12));
                    target.draw_iter(r.points().filter(|p| toned(*p, tone)).map(|p| Pixel(p, BinaryColor::On)))?;
                }
                text::label(
                    target,
                    font,
                    &series.label,
                    Point::new(x + gap, area.top_left.y + baseline),
                    (slot - gap - 2).max(0),
                    BinaryColor::On,
                    HorizontalAlignment::Left,
                )?;
            }
            let point = |i: usize, value: f64| {
                Point::new(
                    origin.x + i as i32 * (width - 1) / n.saturating_sub(1).max(1) as i32,
                    base - (value.min(maximum) / maximum * (height - 1) as f64) as i32,
                )
            };
            let mut previous = None;
            for (i, row) in rows.iter().enumerate() {
                let Some(value) = sample(row, series) else {
                    previous = None;
                    continue;
                };
                let p = point(i, value);
                if series.style == 1 {
                    let start = i as i32 * width / n.max(1) as i32;
                    let end = (i as i32 + 1) * width / n.max(1) as i32;
                    let gutter = if look.native { (end - start) / 4 } else { 2 };
                    let bar_width = ((end - start - gutter) / columns).max(1);
                    let column = if self.stacked { 0 } else { bar_index };
                    let x = origin.x + start + gutter / 2 + column * bar_width;
                    // Native bars: one gap between series, solid / 50 % / 25 % by stroke; stacked
                    // ones share a column, a 1 px rule on each segment's top.
                    let inner = if look.native && columns > 1 { bar_width - 2 } else { bar_width };
                    let (tone, top, bottom, cap) = if self.stacked {
                        let below = stacks[i];
                        stacks[i] += value;
                        (STACK_TONES[(bar_index as usize).min(3)], level(below + value), level(below), 0)
                    } else {
                        ([100, 50, 25][usize::from(series.stroke.min(2))], p.y, base, 1)
                    };
                    let right = (x + inner.max(1)).min(origin.x + width);
                    if top < bottom && (tone == 100 && (look.native || series.stroke == 0)) {
                        // Solid bars: one fill, not a test per pixel.
                        target.fill_solid(&Rectangle::new(Point::new(x, top), Size::new((right - x).max(0) as u32, (bottom - top) as u32)), BinaryColor::On)?;
                    } else if top < bottom {
                        for bx in x..right {
                            target.draw_iter(
                                (top..bottom)
                                    .filter(|y| {
                                        if look.native {
                                            *y <= top + cap || toned(Point::new(bx, *y), tone)
                                        } else {
                                            series.stroke == 0
                                                || (bx + *y) % (if series.stroke == 1 { 3 } else { 2 }) == 0
                                        }
                                    })
                                    .map(|y| Pixel(Point::new(bx, y), BinaryColor::On)),
                            )?;
                        }
                    }
                } else {
                    if let Some(before) = previous {
                        if series.style == 2 {
                            // Stipple preserves distinctions on a one-bit panel.
                            let before: Point = before;
                            for x in before.x..=p.x {
                                let y = before.y
                                    + (p.y - before.y) * (x - before.x) / (p.x - before.x).max(1);
                                target.draw_iter(
                                    (y..base)
                                        .filter(|y| if look.native { toned(Point::new(x, *y), 35) } else { (x + *y) % 3 == 0 })
                                        .map(|y| Pixel(Point::new(x, y), BinaryColor::On)),
                                )?;
                            }
                        }
                        thick(target, before, p, series.stroke, look.weight)?;
                    }
                    Pixel(p, BinaryColor::On).draw(target)?;
                    previous = Some(p);
                }
            }
            if series.style == 1 {
                bar_index += 1;
            }
        }
        if label_axes && !self.x_key.is_empty() && n > 0 {
            let label_of = |i: usize| {
                rows[i]
                    .get(self.x_key)
                    .map(|v| v.as_str().map(str::to_owned).unwrap_or_else(|| v.to_string()))
                    .unwrap_or_default()
            };
            let labels: Vec<String> = (0..n).map(label_of).collect();
            // As many labels as fit with air between them: every `step`-th category. Bars carry
            // theirs centred underneath; a line's sit on its points, the ends kept inside.
            let widest = labels.iter().map(|l| text::spaced_width(font, l, 0)).max().unwrap_or(0);
            let slot = (width / n as i32).max(1);
            let step = ((widest + 8 + slot - 1) / slot).max(1) as usize;
            let bars = self.series.iter().any(|series| series.style == 1);
            for i in (0..n).step_by(step) {
                let (x, align) = if bars {
                    (origin.x + i as i32 * width / n as i32 + slot / 2, HorizontalAlignment::Center)
                } else {
                    let x = origin.x + i as i32 * (width - 1) / n.saturating_sub(1).max(1) as i32;
                    let align = if i == 0 {
                        HorizontalAlignment::Left
                    } else if i + 1 == n {
                        HorizontalAlignment::Right
                    } else {
                        HorizontalAlignment::Center
                    };
                    (x, align)
                };
                text::label(
                    target,
                    font,
                    &labels[i],
                    Point::new(x, base + if look.native { 24 } else { 11 }),
                    (slot * step as i32 - 2).max(0),
                    BinaryColor::On,
                    align,
                )?;
            }
        }
        Ok(())
    }
}
