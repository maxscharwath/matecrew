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
        let theme = data
            .get("local")
            .and_then(|v| v.get("theme"))
            .or_else(|| self.state.get("theme"))
            .and_then(Value::as_str)
            .map(Theme::from_name)
            .unwrap_or_default();
        self.render_with_theme(target, data, scale, theme)
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
        let mut themed = Themed { target, theme };
        let mut px = Pixelated::new(&mut themed, scale);
        if clear {
            px.clear(BinaryColor::Off)?;
        }
        let mut viewport = px.clipped(&Rectangle::new(
            Point::zero(),
            Size::new(self.width, self.height),
        ));
        draw_node(
            &self.root,
            &mut viewport,
            Point::zero(),
            data,
            None,
            Rectangle::new(Point::zero(), Size::new(self.width, self.height)),
            &mut RenderPass {
                remaining: 2048,
                theme,
            },
        )
    }
}
fn content(value: &Value) -> String {
    match value {
        Value::String(s) => s.chars().take(512).collect(),
        Value::Number(_) | Value::Bool(_) => value.to_string(),
        _ => "—".into(),
    }
}
struct RenderPass {
    remaining: usize,
    theme: Theme,
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
fn draw_node<D: DrawTarget<Color = BinaryColor>>(
    node: &Node,
    d: &mut D,
    origin: Point,
    data: &Value,
    item: Option<&Value>,
    clip: Rectangle,
    pass: &mut RenderPass,
) -> Result<(), D::Error> {
    if pass.remaining == 0 {
        return Ok(());
    }
    pass.remaining -= 1;
    let area = node.rect().area(origin);
    // Shadows may extend beyond the surface, but never beyond its parent's clip.
    if let Node::Panel { style: Some(style), .. } = node {
        style.shadow(&mut d.clipped(&clip), area, pass.theme.radius(false))?;
    }
    if area.intersection(&d.bounding_box()).size == Size::zero() {
        return Ok(());
    }
    let clip = clip.intersection(&area);
    let mut cell = d.clipped(&clip);
    match node {
        Node::Router { .. } => {
            if let Some(route) = node.active_route(data) {
                draw_node(route, d, area.top_left, data, item, clip, pass)?;
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
            let mut offset = area.top_left;
            for child in children {
                draw_node(child, d, offset, data, item, clip, pass)?;
                match node {
                    Node::Row { gap, .. } => {
                        offset.x = offset.x.saturating_add(
                            child.rect().width.min(4096) as i32 + (*gap).min(4096) as i32,
                        )
                    }
                    Node::Column { gap, .. } => {
                        offset.y = offset.y.saturating_add(
                            child.rect().height.min(4096) as i32 + (*gap).min(4096) as i32,
                        )
                    }
                    _ => {}
                }
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
            let resolved = typography.as_ref().map_or_else(|| super::typography::Resolved::plain(pass.theme.font(*font)), |style| style.resolve(pass.theme, *font));
            let font = resolved.font;
            let extra = resolved.extra();
            let available = (area.size.width as i32 - extra).max(0);
            let string = content(value.resolve(data, item));
            let metrics = font.get_font_bounding_box(u8g2_fonts::types::VerticalPosition::Baseline);
            let baseline = -metrics.top_left.y;
            let line_height = metrics.size.height as i32 + 2;
            let visible_lines = (area.size.height as i32 / line_height).max(1) as usize;
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
            for (i, line) in text::lines(
                font,
                &string,
                available,
                usize::from((*max_lines).min(8)).min(visible_lines),
            )
            .iter()
            .enumerate()
            {
                let line_baseline = area.top_left.y + baseline + i as i32 * line_height;
                let mut ink = super::typography::Ink { target: &mut cell, baseline: line_baseline, italic: resolved.italic, embolden: resolved.embolden, max_shift: extra };
                text::label(
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
                )?;
            }
        }
        Node::Button {
            label, dock, icon, ..
        } => {
            super::button::draw(
                &mut cell,
                area,
                pass.theme,
                &content(label.resolve(data, item)),
                *dock,
                icon.as_ref(),
            )?;
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
            let (stroke, axes) = if let Node::Plot { stroke, axes, .. } = node {
                (*stroke, *axes)
            } else {
                (0, false)
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
                let point = |i: usize| {
                    area.top_left
                        + Point::new(
                            (i as u32 * area.size.width.saturating_sub(1)
                                / (n as u32).saturating_sub(1).max(1))
                                as i32,
                            area.size.height.saturating_sub(1) as i32
                                - (samples[i].as_f64().unwrap_or(0.0).clamp(0.0, maximum) / maximum
                                    * area.size.height.saturating_sub(1) as f64)
                                    as i32,
                        )
                };
                let mut phase = 0;
                for i in 1..n {
                    let pixels = Line::new(point(i - 1), point(i))
                        .into_styled(PrimitiveStyle::with_stroke(BinaryColor::On, 1))
                        .pixels();
                    cell.draw_iter(pixels.filter(|_| {
                        let on = match stroke {
                            1 => phase % 3 == 0,
                            2 => phase % 6 < 3,
                            _ => true,
                        };
                        phase += 1;
                        on
                    }))?;
                }
                if n > 0 {
                    Pixel(point(n - 1), BinaryColor::On).draw(&mut cell)?;
                }
            }
        }
        Node::When { value, child, .. } | Node::Modal { value, child, .. } => {
            if value.resolve(data, item).as_bool().unwrap_or(false) {
                if matches!(node, Node::Modal { .. }) {
                    cell.draw_iter(
                        area.points()
                            .filter(|p| (p.x + p.y) % 2 == 0)
                            .map(|p| Pixel(p, BinaryColor::Off)),
                    )?;
                }
                draw_node(child, d, area.top_left, data, item, clip, pass)?;
            }
        }
        Node::Image {
            value,
            source_width,
            source_height,
            ..
        } => {
            if let Some(values) = value.resolve(data, item).as_array() {
                let bits: Vec<u8> = values
                    .iter()
                    .take(65536)
                    .map(|v| v.as_u64().unwrap_or(0) as u8)
                    .collect();
                if let Some(sprite) = crate::sprite::PackedSprite::new(
                    &bits,
                    Size::new(*source_width, *source_height),
                ) {
                    sprite.draw_resized(
                        &mut cell,
                        area.top_left,
                        area.size,
                        BinaryColor::On,
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
            ..
        } => {
            super::charts::Chart {
                data: values.resolve(data, item),
                max: max.resolve(data, item),
                series,
                x_key,
                axes: *axes,
                grid: *grid,
                legend: *legend,
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
        Node::Qr { value, .. } => {
            if let Some(payload) = value
                .resolve(data, item)
                .as_str()
                .filter(|s| s.len() <= 2048)
            {
                if let Ok(qr) = qrcodegen::QrCode::encode_text(payload, qrcodegen::QrCodeEcc::Low) {
                    let side = qr.size() as u32 + 8;
                    let module = area.size.width.min(area.size.height) / side;
                    if module > 0 {
                        // QR keeps black modules on white even in a dark theme.
                        let ink = if pass.theme == Theme::Dark {
                            cell.fill_solid(&area, BinaryColor::On)?;
                            BinaryColor::Off
                        } else {
                            BinaryColor::On
                        };
                        let offset = Point::new(
                            (area.size.width - side * module) as i32 / 2,
                            (area.size.height - side * module) as i32 / 2,
                        );
                        for y in 0..qr.size() {
                            for x in 0..qr.size() {
                                if qr.get_module(x, y) {
                                    cell.fill_solid(
                                        &Rectangle::new(
                                            area.top_left
                                                + offset
                                                + Point::new(
                                                    (x + 4) * module as i32,
                                                    (y + 4) * module as i32,
                                                ),
                                            Size::new(module, module),
                                        ),
                                        ink,
                                    )?;
                                }
                            }
                        }
                    }
                }
            }
        }
        Node::Repeat {
            value, child, gap, ..
        } => {
            if let Some(items) = value.resolve(data, item).as_array() {
                for (i, entry) in items.iter().take(32).enumerate() {
                    let origin = area.top_left
                        + Point::new(
                            0,
                            i as i32 * (child.rect().height as i32 + (*gap).min(4096) as i32),
                        );
                    draw_node(child, d, origin, data, Some(entry), clip, pass)?;
                }
            }
        }
    }
    Ok(())
}
