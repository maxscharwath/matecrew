//! The 7.5" V2 panel's controller (UC8179), driven directly: epd-waveshare
//! has no partial refresh for it. Command sequences follow Waveshare's
//! EPD_7in5_V2 driver.
//!
//! Two refreshes:
//! - full: the controller's own waveform, about 3.5 s with the black and white
//!   flashes. Clears ghosting.
//! - partial: one rectangle, no flashing, well under a second.

use anyhow::{bail, Result};
use esp_idf_svc::hal::{
    delay::FreeRtos,
    gpio::{Input, Output, PinDriver},
    spi::{SpiDeviceDriver, SpiDriver},
};
use matecrew_ui::frame::Window;
use std::time::{Duration, Instant};

type Spi = SpiDeviceDriver<'static, SpiDriver<'static>>;

/// A refresh never takes this long; past it the panel is not answering.
const BUSY_TIMEOUT: Duration = Duration::from_secs(10);

/// In partial mode the data interval setting (0x50 = A9) flips the meaning of
/// a bit: 0 is ink. Full mode (0x50 = 10) takes 1 as ink, like our frames.
const PARTIAL_INVERTS: bool = true;

pub struct Epd {
    spi: Spi,
    busy: PinDriver<'static, Input>,
    dc: PinDriver<'static, Output>,
    rst: PinDriver<'static, Output>,
}

impl Epd {
    pub fn new(spi: Spi, busy: PinDriver<'static, Input>, dc: PinDriver<'static, Output>, rst: PinDriver<'static, Output>) -> Self {
        Self { spi, busy, dc, rst }
    }

    /// Wakes the controller and refreshes the whole panel with `frame`.
    pub fn full(&mut self, frame: &[u8]) -> Result<()> {
        self.reset()?;
        self.command(0x06, &[0x17, 0x17, 0x27, 0x17])?; // booster soft start
        self.command(0x01, &[0x07, 0x17, 0x3F, 0x3F])?; // power setting
        self.command(0x04, &[])?; // power on
        self.wait()?;
        self.command(0x00, &[0x1F])?; // panel setting: black and white, waveform from OTP
        self.command(0x30, &[0x06])?; // PLL
        self.command(0x61, &[0x03, 0x20, 0x01, 0xE0])?; // 800 x 480
        self.command(0x15, &[0x00])?; // single SPI
        self.command(0x60, &[0x22])?; // TCON
        self.command(0x50, &[0x10, 0x07])?; // data interval: 1 = ink
        self.data_command(0x13, frame.iter().copied())?;
        self.command(0x12, &[])?; // refresh
        FreeRtos::delay_ms(100);
        self.wait()?;
        self.sleep()
    }

    /// Wakes the controller and refreshes only `window`, from `before` to `after` (whole frames).
    pub fn partial(&mut self, window: Window, before: &[u8], after: &[u8]) -> Result<()> {
        let ink = |b: u8| if PARTIAL_INVERTS { !b } else { b };
        self.reset()?;
        self.command(0x00, &[0x1F])?;
        self.command(0x04, &[])?;
        self.wait()?;
        self.command(0xE0, &[0x02])?; // cascade: use the temperature below
        self.command(0xE5, &[0x6E])?; // force 110: the controller's fast waveform
        self.command(0x50, &[0xA9, 0x07])?; // data interval for partial updates
        self.command(0x91, &[])?; // partial in
        let (x_end, y_end) = (window.x + window.width - 1, window.y + window.height - 1);
        let edge = |v: u32| [(v >> 8) as u8, (v & 0xFF) as u8];
        let mut area = Vec::with_capacity(9);
        for v in [window.x, x_end, window.y, y_end] {
            area.extend_from_slice(&edge(v));
        }
        area.push(0x01); // scan inside the window only
        self.command(0x90, &area)?;
        self.data_command(0x10, window.bytes(before).map(ink))?;
        self.data_command(0x13, window.bytes(after).map(ink))?;
        self.command(0x12, &[])?;
        FreeRtos::delay_ms(10);
        self.wait()?;
        self.command(0x92, &[])?; // partial out
        self.sleep()
    }

    fn sleep(&mut self) -> Result<()> {
        self.command(0x02, &[])?; // power off
        self.wait()?;
        self.command(0x07, &[0xA5]) // deep sleep
    }

    fn reset(&mut self) -> Result<()> {
        self.rst.set_high()?;
        FreeRtos::delay_ms(20);
        self.rst.set_low()?;
        FreeRtos::delay_ms(2);
        self.rst.set_high()?;
        FreeRtos::delay_ms(20);
        Ok(())
    }

    /// BUSY is low while the controller works. It answers 0x71 (get status) meanwhile.
    fn wait(&mut self) -> Result<()> {
        let start = Instant::now();
        loop {
            self.command(0x71, &[])?;
            if self.busy.is_high() {
                return Ok(());
            }
            if start.elapsed() > BUSY_TIMEOUT {
                bail!("panel busy for more than {BUSY_TIMEOUT:?}");
            }
            FreeRtos::delay_ms(5);
        }
    }

    fn command(&mut self, command: u8, data: &[u8]) -> Result<()> {
        self.dc.set_low()?;
        self.spi.write(&[command])?;
        if !data.is_empty() {
            self.dc.set_high()?;
            self.spi.write(data)?;
        }
        Ok(())
    }

    /// A command followed by a stream of data, sent in chunks the SPI driver takes in one go.
    fn data_command(&mut self, command: u8, data: impl Iterator<Item = u8>) -> Result<()> {
        self.command(command, &[])?;
        self.dc.set_high()?;
        let mut chunk = Vec::with_capacity(4096);
        for byte in data {
            chunk.push(byte);
            if chunk.len() == chunk.capacity() {
                self.spi.write(&chunk)?;
                chunk.clear();
            }
        }
        if !chunk.is_empty() {
            self.spi.write(&chunk)?;
        }
        Ok(())
    }
}
