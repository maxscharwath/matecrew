use super::*;
use crate::{
    pixelated::Pixelated,
    text,
    theme::{Theme, Themed},
};
use embedded_graphics::{
    pixelcolor::BinaryColor,
    primitives::{CornerRadii, Line, PrimitiveStyle, RoundedRectangle},
};
use u8g2_fonts::types::HorizontalAlignment;
impl Scene {
    /// The host supplies an arbitrary display target and integer scale. The renderer never fetches data.
    pub fn render<D: DrawTarget<Color = BinaryColor>>(
        &self,
        target: &mut D,
        data: &Value,
        scale: u32,
    ) -> Result<(), D::Error> {
        self.render_with_theme(target, data, scale, self.theme_for(data))
    }
    /// The theme the app chose (local state), else the one it declared.
    pub(crate) fn theme_for(&self, data: &Value) -> Theme {
        data.get("local")
            .and_then(|v| v.get("theme"))
            .or_else(|| self.state.get("theme"))
            .and_then(Value::as_str)
            .map(Theme::from_name)
            .unwrap_or_default()
    }
    pub fn render_with_theme<D: DrawTarget<Color = BinaryColor>>(
        &self,
        target: &mut D,
        data: &Value,
        scale: u32,
        theme: Theme,
    ) -> Result<(), D::Error> {
        self.paint(target, data, scale, theme, true)
    }
    /// Compose a TSX system layer over an existing frame without clearing it.
    pub fn render_layer<D: DrawTarget<Color = BinaryColor>>(
        &self,
        target: &mut D,
        data: &Value,
        scale: u32,
        theme: Theme,
    ) -> Result<(), D::Error> {
        self.paint(target, data, scale, theme, false)
    }
    fn paint<D: DrawTarget<Color = BinaryColor>>(
        &self,
        target: &mut D,
        data: &Value,
        scale: u32,
        theme: Theme,
        clear: bool,
    ) -> Result<(), D::Error> {
        if self.validate().is_err() || scale == 0 || scale > 16 {
            return Ok(());
        }
        let flip = std::cell::Cell::new(false);
        let mut themed = Themed { target, theme, flip: &flip };
        let mut px = Pixelated::new(&mut themed, scale);
        if clear {
            px.clear(BinaryColor::Off)?;
        }
        let screen = Rectangle::new(Point::zero(), Size::new(self.width, self.height));
        let mut viewport = crate::clip::Clip::new(&mut px, screen);
        let area = super::layout::absolute(&self.root, screen, super::layout::Env { data, theme }, None);
        draw_node(
            &self.root,
            &mut viewport,
            area,
            data,
            None,
            Rectangle::new(Point::zero(), Size::new(self.width, self.height)),
            &mut RenderPass {
                remaining: 2048,
                theme,
                flip: &flip,
            },
        )
    }
}
fn content(value: &Value) -> String {
    super::expr::text(value)
}
struct RenderPass<'a> {
    remaining: usize,
    theme: Theme,
    /// Shared with the `Themed` target: true inside ink surfaces.
    flip: &'a std::cell::Cell<bool>,
}
impl RenderPass<'_> {
    /// Ink and paper are swapped where we draw (dark theme, or inside an ink surface).
    fn swapped(&self) -> bool {
        (self.theme == Theme::Dark) != self.flip.get()
    }
}
/// A surface whose content reads in paper.
fn ink_surface(node: &Node) -> bool {
    match node {
        Node::Panel { style: Some(style), .. } => style.background == 1 && style.opacity == 100,
        Node::Panel { inverted, .. } => *inverted,
        _ => false,
    }
}
fn panel<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    area: Rectangle,
    inverted: bool,
    radius: u32,
) -> Result<(), D::Error> {
    RoundedRectangle::new(area, CornerRadii::new(Size::new(radius, radius)))
        .into_styled(if inverted {
            PrimitiveStyle::with_fill(BinaryColor::On)
        } else {
            embedded_graphics::primitives::PrimitiveStyleBuilder::new()
                .stroke_color(BinaryColor::On)
                .stroke_width(1)
                .fill_color(BinaryColor::Off)
                .build()
        })
        .draw(d)
}
/// Draw `node` in `area`, the rectangle layout gave it.
fn draw_node<D: DrawTarget<Color = BinaryColor>>(
    node: &Node,
    d: &mut D,
    area: Rectangle,
    data: &Value,
    item: Option<&Value>,
    clip: Rectangle,
    pass: &mut RenderPass,
) -> Result<(), D::Error> {
    if pass.remaining == 0 {
        return Ok(());
    }
    pass.remaining -= 1;
    let env = super::layout::Env { data, theme: pass.theme };
    // Shadows may extend beyond the surface, but never beyond its parent's clip.
    if let Node::Panel { style: Some(style), .. } = node {
        style.shadow(&mut crate::clip::Clip::new(d, clip), area, pass.theme.radius(false))?;
    }
    if area.intersection(&d.bounding_box()).size == Size::zero() {
        return Ok(());
    }
    let clip = clip.intersection(&area);
    let mut cell = crate::clip::Clip::new(d, clip);
    match node {
        Node::Router { .. } => {
            if let Some(route) = node.active_route(data) {
                draw_node(route, d, super::layout::absolute(route, area, env, item), data, item, clip, pass)?;
            }
        }
        Node::Group { children, .. }
        | Node::Panel { children, .. }
        | Node::Row { children, .. }
        | Node::Column { children, .. } => {
            if let Node::Panel { inverted, style, .. } = node {
                if let Some(style) = style {
                    style.draw(&mut cell, area, pass.theme.radius(false))?;
                } else {
                    panel(&mut cell, area, *inverted, pass.theme.radius(false))?;
                }
            }
            let ink = ink_surface(node);
            if ink {
                pass.flip.set(!pass.flip.get());
            }
            for (child, placed) in children.iter().zip(super::layout::place(node, area, env, item)) {
                draw_node(child, d, placed, data, item, clip, pass)?;
            }
            if ink {
                pass.flip.set(!pass.flip.get());
            }
        }
        Node::Text {
            value,
            font,
            align,
            inverted,
            max_lines,
            typography,
            ..
        } => {
            let string = content(&value.resolve(data, item));
            // `fit` text takes the largest size of its family that holds it in this box.
            let resolved = match typography.as_ref().filter(|style| style.fit) {
                Some(_) => super::layout::text_font(node, pass.theme, &string, area.size.width as i32).expect("a text node").0,
                None => typography.as_ref().map_or_else(|| super::typography::Resolved::plain(pass.theme.font(*font)), |style| style.resolve(pass.theme, *font)),
            };
            let font = resolved.font;
            let extra = resolved.extra();
            let available = (area.size.width as i32 - extra).max(0);
            let metrics = font.get_font_bounding_box(u8g2_fonts::types::VerticalPosition::Baseline);
            let baseline = -metrics.top_left.y;
            let line_height = metrics.size.height as i32 + 2;
            // The last line needs its glyphs, not the gap after it.
            let visible_lines = ((area.size.height as i32 + 2) / line_height).max(1) as usize;
            let (x, alignment) = match align {
                Align::Left => (area.top_left.x, HorizontalAlignment::Left),
                Align::Center => (
                    area.top_left.x + available / 2,
                    HorizontalAlignment::Center,
                ),
                Align::Right => (
                    area.top_left.x + available,
                    HorizontalAlignment::Right,
                ),
            };
            for (i, line) in text::spaced_lines(
                font,
                &string,
                available,
                usize::from((*max_lines).min(8)).min(visible_lines),
                resolved.tracking,
            )
            .iter()
            .enumerate()
            {
                let line_baseline = area.top_left.y + baseline + i as i32 * line_height;
                let mut ink = super::typography::Ink { target: &mut cell, baseline: line_baseline, italic: resolved.italic, embolden: resolved.embolden, max_shift: extra };
                text::spaced_label(
                    &mut ink,
                    font,
                    line,
                    Point::new(x, line_baseline),
                    available,
                    if *inverted {
                        BinaryColor::Off
                    } else {
                        BinaryColor::On
                    },
                    alignment,
                    resolved.tracking,
                )?;
            }
        }
        Node::Button { ghost: true, .. } => {}
        Node::Button {
            label, dock, icon, ..
        } => {
            super::button::draw(
                &mut cell,
                area,
                pass.theme,
                &content(&label.resolve(data, item)),
                *dock,
                icon.as_ref(),
            )?;
        }
        Node::Progress { value, .. } if matches!(pass.theme, Theme::Paper | Theme::Dark) => {
            // A pill: hairline track, solid bar inset by 3 px, never thinner than a dot.
            let percent = value.resolve(data, item).as_f64().unwrap_or(0.0).clamp(0.0, 100.0);
            let pill = |area: Rectangle| {
                let r = area.size.height / 2;
                RoundedRectangle::new(area, CornerRadii::new(Size::new(r, r)))
            };
            pill(area)
                .into_styled(PrimitiveStyle::with_stroke(BinaryColor::On, 1))
                .draw(&mut cell)?;
            let inner = Size::new(area.size.width.saturating_sub(6), area.size.height.saturating_sub(6));
            if percent > 0.0 && inner.height > 0 {
                let width = ((inner.width as f64 * percent / 100.0) as u32).clamp(inner.height.min(inner.width), inner.width);
                pill(Rectangle::new(area.top_left + Point::new(3, 3), Size::new(width, inner.height)))
                    .into_styled(PrimitiveStyle::with_fill(BinaryColor::On))
                    .draw(&mut cell)?;
            }
        }
        Node::Progress { value, .. } => {
            panel(&mut cell, area, false, pass.theme.radius(false))?;
            let percent = value
                .resolve(data, item)
                .as_f64()
                .unwrap_or(0.0)
                .clamp(0.0, 100.0);
            let width = ((area.size.width.saturating_sub(4)) as f64 * percent / 100.0) as u32;
            if width > 0 {
                cell.fill_solid(
                    &Rectangle::new(
                        area.top_left + Point::new(2, 2),
                        Size::new(width, area.size.height.saturating_sub(4)),
                    ),
                    BinaryColor::On,
                )?;
            }
        }
        Node::Chart { value, max, .. } | Node::Plot { value, max, .. } => {
            let (stroke, axes, weight, fill) = if let Node::Plot { stroke, axes, weight, fill, .. } = node {
                (*stroke, *axes, u32::from(*weight).clamp(1, 4), *fill)
            } else {
                (0, false, 1, 0)
            };
            let maximum = max.resolve(data, item).as_f64().unwrap_or(1.0).max(1.0);
            if axes {
                let bottom =
                    area.top_left + Point::new(0, area.size.height.saturating_sub(1) as i32);
                Line::new(area.top_left, bottom)
                    .into_styled(PrimitiveStyle::with_stroke(BinaryColor::On, 1))
                    .draw(&mut cell)?;
                Line::new(
                    bottom,
                    bottom + Point::new(area.size.width.saturating_sub(1) as i32, 0),
                )
                .into_styled(PrimitiveStyle::with_stroke(BinaryColor::On, 1))
                .draw(&mut cell)?;
            }
            if let Some(samples) = value.resolve(data, item).as_array() {
                let n = samples.len().min(64);
                // Keep thick lines inside the cell: inset by half the weight.
                let inset = (weight / 2) as i32;
                let span_x = area.size.width.saturating_sub(1 + 2 * inset as u32);
                let span_y = area.size.height.saturating_sub(1 + 2 * inset as u32);
                let point = |i: usize| {
                    area.top_left
                        + Point::new(
                            inset + (i as u32 * span_x / (n as u32).saturating_sub(1).max(1)) as i32,
                            inset + span_y as i32
                                - (samples[i].as_f64().unwrap_or(0.0).clamp(0.0, maximum) / maximum
                                    * span_y as f64) as i32,
                        )
                };
                if fill > 0 && n > 1 {
                    let base = area.top_left.y + area.size.height as i32 - 1;
                    for i in 1..n {
                        let (a, b) = (point(i - 1), point(i));
                        for x in a.x..=b.x {
                            let y = a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x).max(1);
                            cell.draw_iter(
                                (y..=base)
                                    .map(|y| Point::new(x, y))
                                    .filter(|p| super::charts::toned(*p, fill))
                                    .map(|p| Pixel(p, BinaryColor::On)),
                            )?;
                        }
                    }
                }
                for i in 1..n {
                    super::charts::thick(&mut cell, point(i - 1), point(i), stroke, weight)?;
                }
                if n > 0 {
                    Pixel(point(n - 1), BinaryColor::On).draw(&mut cell)?;
                }
            }
        }
        Node::When { value, child, .. } | Node::Modal { value, child, .. } => {
            if super::expr::truthy(&value.resolve(data, item)) {
                if matches!(node, Node::Modal { .. }) {
                    cell.draw_iter(
                        area.points()
                            .filter(|p| (p.x + p.y) % 2 == 0)
                            .map(|p| Pixel(p, BinaryColor::Off)),
                    )?;
                }
                draw_node(child, d, super::layout::absolute(child, area, env, item), data, item, clip, pass)?;
            }
        }
        Node::Image {
            value,
            source_width,
            source_height,
            inverted,
            packed,
            ..
        } => {
            let bits: Option<std::borrow::Cow<[u8]>> = match packed {
                Some(bits) => Some(bits.as_slice().into()),
                None => value.resolve(data, item).as_array().map(|values| {
                    values.iter().take(65536).map(|v| v.as_u64().unwrap_or(0) as u8).collect::<Vec<_>>().into()
                }),
            };
            if let Some(bits) = bits {
                if let Some(sprite) = crate::sprite::PackedSprite::new(
                    &bits,
                    Size::new(*source_width, *source_height),
                ) {
                    sprite.draw_resized(
                        &mut cell,
                        area.top_left,
                        area.size,
                        if *inverted { BinaryColor::Off } else { BinaryColor::On },
                        None,
                    )?;
                }
            }
        }
        Node::CartesianChart {
            data: values,
            max,
            series,
            x_key,
            axes,
            grid,
            legend,
            stacked,
            ..
        } => {
            let (values, max) = (values.resolve(data, item), max.resolve(data, item));
            super::charts::Chart {
                data: &values,
                max: &max,
                series,
                x_key,
                axes: *axes,
                grid: *grid,
                legend: *legend,
                stacked: *stacked,
            }
            .draw(&mut cell, area, pass.theme)?;
        }
        Node::WebImage { src, cover, .. } => {
            let request = crate::image::ImageRequest {
                src: src.resolve(data, item).as_str().unwrap_or_default().into(),
                width: area.size.width,
                height: area.size.height,
                cover: *cover,
            };
            let bits = if request.valid() {
                crate::image::unpack_hex(
                    &data[crate::image::CACHE_KEY][request.key()],
                    request.packed_len(),
                )
            } else {
                None
            };
            if let Some(bits) = bits {
                if let Some(sprite) = crate::sprite::PackedSprite::new(&bits, area.size) {
                    sprite.draw(
                        &mut cell,
                        area.top_left,
                        1,
                        BinaryColor::On,
                        Some(BinaryColor::Off),
                    )?;
                }
            } else {
                // A stable placeholder during loading/offline; never a layout shift.
                panel(&mut cell, area, false, pass.theme.radius(false))?;
                if area.size.width >= 12 && area.size.height >= 12 {
                    let center = area.center();
                    for (a, b) in [
                        (Point::new(-4, 3), Point::new(0, -2)),
                        (Point::new(0, -2), Point::new(4, 3)),
                    ] {
                        Line::new(center + a, center + b)
                            .into_styled(PrimitiveStyle::with_stroke(BinaryColor::On, 1))
                            .draw(&mut cell)?;
                    }
                }
            }
        }
        Node::Qr { value, style, ecc, quiet, logo, .. } => {
            if let Some(payload) = value
                .resolve(data, item)
                .as_str()
                .filter(|s| s.len() <= 2048)
            {
                // QR keeps black modules on white even in a dark theme.
                let (paper, ink) = if pass.swapped() {
                    (BinaryColor::On, BinaryColor::Off)
                } else {
                    (BinaryColor::Off, BinaryColor::On)
                };
                super::qr::Qr { payload, style: *style, ecc: *ecc, quiet: *quiet, logo: logo.as_ref(), paper, ink }
                    .draw(&mut cell, area)?;
            }
        }
        Node::Repeat {
            value, child, gap, ..
        } => {
            let list = value.resolve(data, item);
            if let Some(items) = list.as_array() {
                let mut y = 0i32;
                for entry in items.iter().take(32) {
                    let bounds = Rectangle::new(
                        area.top_left + Point::new(0, y),
                        Size::new(area.size.width, area.size.height.saturating_sub(y.max(0) as u32)),
                    );
                    let placed = super::layout::absolute(child, bounds, env, Some(entry));
                    draw_node(child, d, placed, data, Some(entry), clip, pass)?;
                    y = y.saturating_add(placed.size.height as i32 + (*gap).min(4096) as i32);
                }
            }
        }
    }
    Ok(())
}
