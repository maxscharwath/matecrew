//! Device themes change typography, geometry and ink polarity, never network or app logic.
use crate::{scene::Font, style};
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::Rectangle};
use serde::{Deserialize, Serialize};
use u8g2_fonts::{fonts, FontRenderer};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    Flipper,
    Macos,
    Dark,
}
const PIXEL_BODY: FontRenderer = FontRenderer::new::<fonts::u8g2_font_6x12_tf>();
const PIXEL_TITLE: FontRenderer = FontRenderer::new::<fonts::u8g2_font_9x18B_tf>();
const PIXEL_CAPTION: FontRenderer = FontRenderer::new::<fonts::u8g2_font_6x10_tf>();
const PIXEL_DISPLAY: FontRenderer = FontRenderer::new::<fonts::u8g2_font_spleen12x24_mf>();
impl Theme {
    pub fn name(self) -> &'static str {
        match self {
            Self::Flipper => "flipper",
            Self::Macos => "macos",
            Self::Dark => "dark",
        }
    }
    pub fn from_name(name: &str) -> Self {
        match name {
            "macos" => Self::Macos,
            "dark" => Self::Dark,
            _ => Self::Flipper,
        }
    }
    pub fn font(self, font: Font) -> &'static FontRenderer {
        match (self, font) {
            (Self::Flipper, Font::Body) => &PIXEL_BODY,
            (Self::Flipper, Font::Title) => &PIXEL_TITLE,
            (Self::Flipper, Font::Caption) => &PIXEL_CAPTION,
            (Self::Flipper, Font::Display) => &PIXEL_DISPLAY,
            (_, Font::Body) => &style::BODY,
            (_, Font::Title) => &style::TITLE,
            (_, Font::Caption) => &style::CAPTION,
            (_, Font::Display) => &style::DISPLAY,
        }
    }
    pub fn radius(self, button: bool) -> u32 {
        match self {
            Self::Flipper => 2,
            _ if button => 8,
            _ => 6,
        }
    }
}
/// Keep drawing semantics identical for all components, including packed images.
pub(crate) struct Themed<'a, D> {
    pub target: &'a mut D,
    pub theme: Theme,
}
impl<D> Themed<'_, D> {
    fn color(&self, color: BinaryColor) -> BinaryColor {
        if self.theme == Theme::Dark {
            if color.is_on() {
                BinaryColor::Off
            } else {
                BinaryColor::On
            }
        } else {
            color
        }
    }
}
impl<D: Dimensions> Dimensions for Themed<'_, D> {
    fn bounding_box(&self) -> Rectangle {
        self.target.bounding_box()
    }
}
impl<D: DrawTarget<Color = BinaryColor>> DrawTarget for Themed<'_, D> {
    type Color = BinaryColor;
    type Error = D::Error;
    fn draw_iter<I: IntoIterator<Item = Pixel<Self::Color>>>(
        &mut self,
        pixels: I,
    ) -> Result<(), Self::Error> {
        let invert = self.theme == Theme::Dark;
        self.target
            .draw_iter(pixels.into_iter().map(|Pixel(point, color)| {
                Pixel(
                    point,
                    if invert {
                        if color.is_on() {
                            BinaryColor::Off
                        } else {
                            BinaryColor::On
                        }
                    } else {
                        color
                    },
                )
            }))
    }
    fn fill_solid(&mut self, area: &Rectangle, color: Self::Color) -> Result<(), Self::Error> {
        self.target.fill_solid(area, self.color(color))
    }
    fn clear(&mut self, color: Self::Color) -> Result<(), Self::Error> {
        self.target.clear(self.color(color))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{frame::Frame, Runtime, Scene};
    use serde_json::json;
    #[test]
    fn themes_change_existing_binary_screens_without_losing_hook_data() {
        let mut app = Runtime::new(
            Scene::from_bytecode(include_bytes!("../tests/fixtures/app.dui")).unwrap(),
        )
        .unwrap();
        app.update(
            "stock",
            json!({"office":{"name":"Inventory"},"items":[{"name":"Classic","stock":36}]}),
        );
        let mut frame = Frame::new(800, 480).unwrap();
        app.scene().render(&mut frame, app.data(), 4).unwrap();
        let flipper = frame.bits.clone();
        app.set_theme(Theme::Macos);
        app.scene().render(&mut frame, app.data(), 4).unwrap();
        let macos = frame.bits.clone();
        assert_ne!(flipper, macos);
        app.set_theme(Theme::Dark);
        app.scene().render(&mut frame, app.data(), 4).unwrap();
        assert_eq!(
            frame.bits,
            macos.into_iter().map(|byte| !byte).collect::<Vec<_>>()
        );
        assert_eq!(app.data()["stock"]["items"][0]["stock"], 36);
    }
    #[test]
    fn dark_theme_keeps_qr_modules_black_on_white() {
        let scene:Scene=serde_json::from_value(json!({"version":1,"width":100,"height":100,"state":{},"root":{"kind":"qr","rect":{"x":10,"y":10,"width":80,"height":80},"value":{"literal":"https://example.org/link"}}})).unwrap();
        let mut light = Frame::new(100, 100).unwrap();
        let mut dark = Frame::new(100, 100).unwrap();
        scene
            .render_with_theme(&mut light, &json!({}), 1, Theme::Macos)
            .unwrap();
        scene
            .render_with_theme(&mut dark, &json!({}), 1, Theme::Dark)
            .unwrap();
        // Compare the QR cell itself, including its quiet zone, while surroundings invert.
        for y in 10..90 {
            for x in 10..90 {
                let index = y * light.row_bytes() + x / 8;
                let mask = 128 >> (x % 8);
                assert_eq!(light.bits[index] & mask, dark.bits[index] & mask);
            }
        }
        assert_ne!(light.bits[0], dark.bits[0]);
    }
}
