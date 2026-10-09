//! The 7.5" panel behind the ePaper Driver Board for XIAO.
//!
//! Screens are drawn into a frame in memory, then only what changed is sent:
//! nothing when the frame is the same, a partial refresh of the changed
//! rectangle otherwise, the controller kept awake from one to the next. Back
//! on the main screen it goes to sleep. A full refresh, flashing, clears the
//! ghosting partial refreshes leave: at the first screen, then on the main
//! screen after FULL_EVERY partial ones or FULL_AFTER, with the fast waveform.

use anyhow::{bail, Result};
use core::convert::Infallible;
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*};
use esp_idf_svc::hal::{
    gpio::{AnyIOPin, Gpio1, Gpio2, Gpio3, Gpio4, Gpio7, Gpio9, PinDriver, Pull},
    spi::{config::Config, Dma, SpiDeviceDriver, SpiDriverConfig, SPI2},
    units::FromValueType,
};
use matecrew_ui::frame::{self, Frame};
use std::time::{Duration, Instant};

use crate::epd::{Epd, CHUNK};

pub type Canvas = Frame;

const FULL_EVERY: u32 = 40;
const FULL_AFTER: Duration = Duration::from_secs(60 * 60);

pub struct Screen {
    epd: Epd,
    /// What the panel shows.
    shown: Vec<u8>,
    next: Frame,
    partials: u32,
    last_full: Option<Instant>,
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
        let spi = SpiDeviceDriver::new_single(
            pins.spi,
            pins.sck,
            pins.mosi,
            Option::<AnyIOPin>::None,
            Some(pins.cs),
            &SpiDriverConfig::new().dma(Dma::Auto(CHUNK)),
            &Config::new().baudrate(4u32.MHz().into()),
        )?;
        let epd = Epd::new(
            spi,
            PinDriver::input(pins.busy, Pull::Floating)?,
            PinDriver::output(pins.dc)?,
            PinDriver::output(pins.rst)?,
        );
        Ok(Self { epd, shown: vec![0; frame::BYTES], next: Frame::new(), partials: 0, last_full: None })
    }

    /// Draws a screen from `matecrew_ui`: a partial refresh of what changed.
    pub fn show(&mut self, draw: impl FnOnce(&mut Canvas) -> Result<(), Infallible>) -> Result<()> {
        let _ = self.next.clear(BinaryColor::Off);
        let _ = draw(&mut self.next);
        self.present(false)
    }

    /// Draws the site's main screen: rows top to bottom, MSB first, 1 = ink.
    /// The moment to clear the ghosting with a full refresh, when it is due.
    pub fn show_bits(&mut self, bits: &[u8]) -> Result<()> {
        if bits.len() != frame::BYTES {
            bail!("screen bitmap is {} bytes", bits.len());
        }
        self.next.bits.copy_from_slice(bits);
        let due = self.partials >= FULL_EVERY || self.last_full.is_some_and(|at| at.elapsed() > FULL_AFTER);
        self.present(due)?;
        // The main screen stays until the next key or sync: power the panel down.
        if self.epd.is_awake() {
            self.epd.sleep()?;
        }
        Ok(())
    }

    /// What the panel shows, in the format of the site's screen: 1 = ink.
    pub fn frame(&self) -> &[u8] {
        &self.shown
    }

    fn present(&mut self, full: bool) -> Result<()> {
        let started = Instant::now();
        let changed = frame::changed(&self.shown, &self.next.bits);
        if self.last_full.is_none() || full {
            // The first refresh takes the long waveform: nobody knows what the panel showed before.
            let fast = self.last_full.is_some();
            self.epd.full(&self.next.bits, fast)?;
            self.partials = 0;
            self.last_full = Some(Instant::now());
            log::info!("display: {} refresh in {} ms", if fast { "fast" } else { "full" }, started.elapsed().as_millis());
        } else if let Some(window) = changed {
            self.epd.partial(window, &self.shown, &self.next.bits)?;
            self.partials += 1;
            log::info!("display: {} x {} at {},{} in {} ms", window.width, window.height, window.x, window.y, started.elapsed().as_millis());
        } else {
            return Ok(());
        }
        self.shown.copy_from_slice(&self.next.bits);
        Ok(())
    }
}
