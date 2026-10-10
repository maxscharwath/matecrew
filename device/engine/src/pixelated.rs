use embedded_graphics::{pixelcolor::BinaryColor, prelude::*, primitives::Rectangle};

/// Draws on a target `scale` times smaller: every logical pixel becomes a
/// `scale` x `scale` block, which gives the chunky 1-bit look.
pub struct Pixelated<'a, D> {
    target: &'a mut D,
    scale: u32,
}

impl<'a, D> Pixelated<'a, D> {
    pub fn new(target: &'a mut D, scale: u32) -> Self {
        Self { target, scale }
    }

    pub fn scale(&self) -> u32 {
        self.scale
    }

    /// The physical target, for what must not be pixelated (a QR stays scannable smaller).
    pub fn inner(&mut self) -> &mut D {
        self.target
    }

    fn up(&self, rect: &Rectangle) -> Rectangle {
        let s = self.scale as i32;
        Rectangle::new(
            Point::new(rect.top_left.x * s, rect.top_left.y * s),
            Size::new(rect.size.width * self.scale, rect.size.height * self.scale),
        )
    }
}

impl<D> DrawTarget for Pixelated<'_, D>
where
    D: DrawTarget<Color = BinaryColor>,
{
    type Color = BinaryColor;
    type Error = D::Error;

    fn draw_iter<I>(&mut self, pixels: I) -> Result<(), Self::Error>
    where
        I: IntoIterator<Item = Pixel<Self::Color>>,
    {
        // Native apps draw at 1×: a pixel is a pixel, not a one-pixel block to clip and mask.
        if self.scale == 1 {
            return self.target.draw_iter(pixels);
        }
        for Pixel(point, color) in pixels {
            let block = self.up(&Rectangle::new(point, Size::new(1, 1)));
            self.target.fill_solid(&block, color)?;
        }
        Ok(())
    }

    fn fill_solid(&mut self, area: &Rectangle, color: Self::Color) -> Result<(), Self::Error> {
        if self.scale == 1 {
            return self.target.fill_solid(area, color);
        }
        let block = self.up(area);
        self.target.fill_solid(&block, color)
    }

    fn clear(&mut self, color: Self::Color) -> Result<(), Self::Error> {
        self.target.clear(color)
    }
}

impl<D> Dimensions for Pixelated<'_, D>
where
    D: Dimensions,
{
    fn bounding_box(&self) -> Rectangle {
        let bounds = self.target.bounding_box();
        let s = self.scale;
        Rectangle::new(
            Point::new(bounds.top_left.x / s as i32, bounds.top_left.y / s as i32),
            Size::new(bounds.size.width / s, bounds.size.height / s),
        )
    }
}
