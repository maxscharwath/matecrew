//! Inline icon and label layout, shared by pointer buttons and physical key hints.
use super::ButtonIcon;
use crate::{sprite::PackedSprite, text, Theme};
use embedded_graphics::{
    pixelcolor::BinaryColor,
    prelude::*,
    primitives::{CornerRadii, Line, PrimitiveStyle, Rectangle, RoundedRectangle},
};
use u8g2_fonts::types::{HorizontalAlignment, VerticalPosition};

pub(super) fn draw<D: DrawTarget<Color = BinaryColor>>(
    target: &mut D,
    area: Rectangle,
    theme: Theme,
    label: &str,
    dock: bool,
    icon: Option<&ButtonIcon>,
) -> Result<(), D::Error> {
    let mut corners = CornerRadii::new(Size::new(theme.radius(true), theme.radius(true)));
    if dock {
        corners.bottom_left = Size::zero();
        corners.bottom_right = Size::zero();
    }
    RoundedRectangle::new(area, corners)
        .into_styled(if dock {
            PrimitiveStyle::with_fill(BinaryColor::On)
        } else {
            PrimitiveStyle::with_stroke(BinaryColor::On, 1)
        })
        .draw(target)?;
    let color = if dock {
        BinaryColor::Off
    } else {
        BinaryColor::On
    };
    let font = theme.font(super::Font::Body);
    // Keep native pixels; an icon that cannot fit is omitted instead of being mangled.
    let icon = icon.filter(|i| i.height + 4 <= area.size.height && i.width + 20 <= area.size.width);
    let leading = icon.map_or(0, |i| i.width as i32 + 6);
    let trailing = if dock { 14 } else { 0 };
    let available = (area.size.width as i32 - 16 - leading - trailing).max(0);
    let label = text::fit(font, label, available);
    let bounds = font
        .get_rendered_dimensions(label.as_str(), Point::zero(), VerticalPosition::Baseline)
        .ok()
        .and_then(|d| d.bounding_box);
    let width = bounds.map_or(0, |b| b.size.width as i32);
    let x = area.top_left.x + (area.size.width as i32 - leading - width - trailing) / 2;
    let mid = area.top_left.y + area.size.height as i32 / 2;
    if let Some(icon) = icon {
        if let Some(sprite) = PackedSprite::new(&icon.bits, Size::new(icon.width, icon.height)) {
            sprite.draw(
                target,
                Point::new(x, mid - icon.height as i32 / 2),
                1,
                color,
                None,
            )?;
        }
    }
    let baseline = bounds.map_or(mid, |b| mid - b.size.height as i32 / 2 - b.top_left.y);
    text::label(
        target,
        font,
        &label,
        Point::new(x + leading, baseline),
        available,
        color,
        HorizontalAlignment::Left,
    )?;
    if dock {
        let tip = Point::new(x + leading + width + 10, mid + 3);
        for (a, b) in [
            (tip + Point::new(0, -6), tip),
            (tip + Point::new(-3, -3), tip),
            (tip + Point::new(3, -3), tip),
        ] {
            Line::new(a, b)
                .into_styled(PrimitiveStyle::with_stroke(color, 1))
                .draw(target)?;
        }
    }
    Ok(())
}
