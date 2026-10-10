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
}
fn patterned<D: DrawTarget<Color = BinaryColor>>(
    target: &mut D,
    a: Point,
    b: Point,
    stroke: u8,
) -> Result<(), D::Error> {
    target.draw_iter(
        Line::new(a, b)
            .into_styled(PrimitiveStyle::with_stroke(BinaryColor::On, 1))
            .pixels()
            .enumerate()
            .filter_map(|(i, p)| {
                (match stroke {
                    1 => i % 3 == 0,
                    2 => i % 6 < 3,
                    _ => true,
                })
                .then_some(p)
            }),
    )
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
                    .flat_map(|row| {
                        self.series
                            .iter()
                            .filter_map(move |series| sample(row, series))
                    })
                    .fold(1.0, f64::max)
            });
        let label_axes = self.axes && area.size.width >= 72 && area.size.height >= 40;
        let left = if label_axes { 25 } else { 1 };
        let top = if self.legend { 13 } else { 1 };
        let bottom = if label_axes && !self.x_key.is_empty() {
            13
        } else {
            2
        };
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
            for (value, y) in [(maximum, origin.y + 8), (0.0, base)] {
                text::label(
                    target,
                    font,
                    &number(value),
                    Point::new(origin.x - 3, y),
                    22,
                    BinaryColor::On,
                    HorizontalAlignment::Right,
                )?;
            }
        }
        let n = rows.len();
        let bars = self.series.iter().filter(|s| s.style == 1).count().max(1) as i32;
        let mut bar_index = 0;
        for (index, series) in self.series.iter().enumerate() {
            if self.legend {
                let slot = area.size.width as i32 / self.series.len() as i32;
                let x = area.top_left.x + index as i32 * slot;
                patterned(
                    target,
                    Point::new(x, area.top_left.y + 5),
                    Point::new(x + 8, area.top_left.y + 5),
                    series.stroke,
                )?;
                text::label(
                    target,
                    font,
                    &series.label,
                    Point::new(x + 11, area.top_left.y + 9),
                    (slot - 13).max(0),
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
                    let bar_width = ((end - start - 2) / bars).max(1);
                    let x = origin.x + start + 1 + bar_index * bar_width;
                    if p.y < base {
                        for bx in x..(x + bar_width).min(origin.x + width) {
                            target.draw_iter(
                                (p.y..base)
                                    .filter(|y| {
                                        series.stroke == 0
                                            || (bx + *y) % (if series.stroke == 1 { 3 } else { 2 })
                                                == 0
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
                                        .filter(|y| (x + *y) % 3 == 0)
                                        .map(|y| Pixel(Point::new(x, y), BinaryColor::On)),
                                )?;
                            }
                        }
                        patterned(target, before, p, series.stroke)?;
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
            let ticks = n.min(3);
            for tick in 0..ticks {
                let i = tick * n.saturating_sub(1) / ticks.saturating_sub(1).max(1);
                let label = rows[i]
                    .get(self.x_key)
                    .map(|v| {
                        v.as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| v.to_string())
                    })
                    .unwrap_or_default();
                let x =
                    origin.x + tick as i32 * (width - 1) / ticks.saturating_sub(1).max(1) as i32;
                let align = if tick == 0 {
                    HorizontalAlignment::Left
                } else if tick + 1 == ticks {
                    HorizontalAlignment::Right
                } else {
                    HorizontalAlignment::Center
                };
                text::label(
                    target,
                    font,
                    &label,
                    Point::new(x, base + 11),
                    (width / ticks as i32 - 2).max(0),
                    BinaryColor::On,
                    align,
                )?;
            }
        }
        Ok(())
    }
}
