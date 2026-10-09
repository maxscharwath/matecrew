//! The 7.5" panel behind the ePaper Driver Board for XIAO.

use anyhow::{anyhow, Result};
use core::convert::Infallible;
use embedded_graphics::{draw_target::ColorConverted, pixelcolor::BinaryColor, prelude::*};
use epd_waveshare::{
    color::Color,
    epd7in5_v2::{Epd7in5, HEIGHT, WIDTH},
    graphics::VarDisplay,
    prelude::*,
};
use esp_idf_svc::hal::{
    delay::Delay,
    gpio::{AnyIOPin, Gpio1, Gpio2, Gpio3, Gpio4, Gpio7, Gpio9, Input, Output, PinDriver, Pull},
    spi::{config::Config, SpiDeviceDriver, SpiDriver, SpiDriverConfig, SPI2},
    units::FromValueType,
};

pub type Canvas<'a, 'b> = ColorConverted<'a, VarDisplay<'b, Color>, BinaryColor>;

type Spi = SpiDeviceDriver<'static, SpiDriver<'static>>;
type Epd = Epd7in5<Spi, PinDriver<'static, Input>, PinDriver<'static, Output>, PinDriver<'static, Output>, Delay>;

pub struct Screen {
    epd: Epd,
    spi: Spi,
    delay: Delay,
    buffer: Vec<u8>,
}

pub struct Pins {
    pub spi: SPI2<'static>,
    pub sck: Gpio7<'static>,
    pub mosi: Gpio9<'static>,
    pub cs: Gpio2<'static>,
    pub busy: Gpio3<'static>,
    pub dc: Gpio4<'static>,
    pub rst: Gpio1<'static>,
}

impl Screen {
    /// XIAO D-pins: RST D0, CS D1, BUSY D2, DC D3, SCK D8, MOSI D10. No MISO:
    /// D9 is the right touch key.
    pub fn new(pins: Pins) -> Result<Self> {
        let mut spi = SpiDeviceDriver::new_single(
            pins.spi,
            pins.sck,
            pins.mosi,
            Option::<AnyIOPin>::None,
            Some(pins.cs),
            &SpiDriverConfig::new(),
            &Config::new().baudrate(4u32.MHz().into()),
        )?;
        let busy = PinDriver::input(pins.busy, Pull::Floating)?;
        let dc = PinDriver::output(pins.dc)?;
        let rst = PinDriver::output(pins.rst)?;
        let mut delay = Delay::new_default();
        let mut epd = Epd7in5::new(&mut spi, busy, dc, rst, &mut delay, None)?;
        epd.sleep(&mut spi, &mut delay)?;
        Ok(Self { epd, spi, delay, buffer: vec![0u8; (WIDTH / 8 * HEIGHT) as usize] })
    }

    /// Draws a screen from `matecrew_ui` and refreshes the whole panel.
    pub fn show(&mut self, draw: impl FnOnce(&mut Canvas) -> Result<(), Infallible>) -> Result<()> {
        let mut display = VarDisplay::<Color>::new(WIDTH, HEIGHT, &mut self.buffer, false)
            .map_err(|e| anyhow!("display buffer: {e:?}"))?;
        let _ = draw(&mut display.color_converted());
        self.refresh()
    }

    /// Draws the server's 1-bit bitmap: rows top to bottom, MSB first, 1 = ink.
    pub fn show_bits(&mut self, bits: &[u8]) -> Result<()> {
        if bits.len() != (WIDTH / 8 * HEIGHT) as usize {
            return Err(anyhow!("screen bitmap is {} bytes", bits.len()));
        }
        let width = WIDTH as usize;
        self.show(|canvas| {
            canvas.draw_iter(bits.iter().enumerate().flat_map(|(byte_index, byte)| {
                (0..8).map(move |bit| {
                    let index = byte_index * 8 + bit;
                    let point = Point::new((index % width) as i32, (index / width) as i32);
                    let ink = byte & (0x80 >> bit) != 0;
                    Pixel(point, if ink { BinaryColor::On } else { BinaryColor::Off })
                })
            }))
        })
    }

    /// What the panel shows, in the format of the site's screen: 1 = ink.
    pub fn frame(&self) -> &[u8] {
        &self.buffer
    }

    fn refresh(&mut self) -> Result<()> {
        // epd-waveshare encodes black as 0, but this panel, set up the way
        // Waveshare's driver does it, reads 1 as black. Every screen redraws
        // the whole buffer, so flipping it in place is safe, and afterwards
        // the buffer holds 1 = ink, like the site's bitmaps.
        for byte in &mut self.buffer {
            *byte = !*byte;
        }
        self.epd.wake_up(&mut self.spi, &mut self.delay)?;
        self.epd.update_and_display_frame(&mut self.spi, &self.buffer, &mut self.delay)?;
        self.epd.sleep(&mut self.spi, &mut self.delay)?;
        Ok(())
    }
}
