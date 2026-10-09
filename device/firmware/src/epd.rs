//! The 7.5" V2 panel's controller (UC8179), driven directly: epd-waveshare
//! has no partial refresh for it. Command sequences follow Waveshare's
//! EPD_7in5_V2 driver.
//!
//! Three refreshes:
//! - full: the controller's own waveform, about 4 s of black and white
//!   flashes. Only at the first screen.
//! - fast: the same with a shorter waveform. Clears the ghosting partial
//!   refreshes leave.
//! - partial: one rectangle, no flashing.
//!
//! Between partial refreshes the controller stays powered and in partial
//! mode: waking it (reset, power on) and sending the old image again would
//! cost more than the refresh itself. `sleep` powers it down.

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

/// Bytes per SPI transaction; the driver moves them by DMA.
pub const CHUNK: usize = 4096;

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    /// Deep sleep: only a reset wakes it, and its memory is gone.
    Asleep,
    /// Powered, in partial mode, its old image in sync with the panel.
    Partial,
}

pub struct Epd {
    spi: Spi,
    busy: PinDriver<'static, Input>,
    dc: PinDriver<'static, Output>,
    rst: PinDriver<'static, Output>,
    state: State,
}

impl Epd {
    pub fn new(spi: Spi, busy: PinDriver<'static, Input>, dc: PinDriver<'static, Output>, rst: PinDriver<'static, Output>) -> Self {
        Self { spi, busy, dc, rst, state: State::Asleep }
    }

    /// Refreshes the whole panel with `frame`; `fast` takes the short
    /// waveform. The controller sleeps afterwards.
    pub fn full(&mut self, frame: &[u8], fast: bool) -> Result<()> {
        self.reset()?;
        if fast {
            self.command(0x00, &[0x1F])?; // panel setting: black and white, waveform from OTP
            self.command(0x50, &[0x10, 0x07])?; // data interval: 1 = ink
            self.command(0x04, &[])?; // power on
            self.wait()?;
            self.command(0x06, &[0x27, 0x27, 0x18, 0x17])?; // stronger booster
            self.command(0xE0, &[0x02])?; // use the temperature below
            self.command(0xE5, &[0x5A])?; // 90: the shorter waveform
        } else {
            self.command(0x06, &[0x17, 0x17, 0x27, 0x17])?; // booster soft start
            self.command(0x01, &[0x07, 0x17, 0x3F, 0x3F])?; // power setting
            self.command(0x04, &[])?;
            self.wait()?;
            self.command(0x00, &[0x1F])?;
            self.command(0x30, &[0x06])?; // PLL
            self.command(0x61, &[0x03, 0x20, 0x01, 0xE0])?; // 800 x 480
            self.command(0x15, &[0x00])?; // single SPI
            self.command(0x60, &[0x22])?; // TCON
            self.command(0x50, &[0x10, 0x07])?;
        }
        self.data_command(0x13, frame.iter().copied())?;
        self.command(0x12, &[])?; // refresh
        FreeRtos::delay_ms(1);
        self.wait()?;
        self.sleep()
    }

    /// Refreshes only `window`, from `before` to `after` (whole frames).
    pub fn partial(&mut self, window: Window, before: &[u8], after: &[u8]) -> Result<()> {
        let ink = |b: u8| if PARTIAL_INVERTS { !b } else { b };
        let started = Instant::now();
        let waking = self.state == State::Asleep;
        if waking {
            self.reset()?;
            self.command(0x00, &[0x1F])?;
            self.command(0x04, &[])?;
            self.wait()?;
            self.command(0xE0, &[0x02])?; // use the temperature below
            self.command(0xE5, &[0x6E])?; // 110: the controller's fast waveform
            // Partial data interval: after each refresh the new image becomes the old one.
            self.command(0x50, &[0xA9, 0x07])?;
        }
        let woken = started.elapsed();
        self.command(0x91, &[])?; // partial in
        let (x_end, y_end) = (window.x + window.width - 1, window.y + window.height - 1);
        let mut area = Vec::with_capacity(9);
        for v in [window.x, x_end, window.y, y_end] {
            area.extend_from_slice(&[(v >> 8) as u8, (v & 0xFF) as u8]);
        }
        area.push(0x01); // scan inside the window only
        self.command(0x90, &area)?;
        if waking {
            // Its memory did not survive the sleep: tell it what the panel shows.
            self.data_command(0x10, window.bytes(before).map(ink))?;
        }
        self.data_command(0x13, window.bytes(after).map(ink))?;
        let sent = started.elapsed();
        self.command(0x12, &[])?;
        FreeRtos::delay_ms(1);
        self.wait()?;
        self.command(0x92, &[])?; // partial out
        self.state = State::Partial;
        log::info!(
            "epd: wake {} ms, send {} ms, refresh {} ms",
            woken.as_millis(),
            (sent - woken).as_millis(),
            (started.elapsed() - sent).as_millis()
        );
        Ok(())
    }

    /// Powers the controller down. A partial refresh wakes it again.
    pub fn sleep(&mut self) -> Result<()> {
        self.command(0x02, &[])?; // power off
        self.wait()?;
        self.command(0x07, &[0xA5])?; // deep sleep
        self.state = State::Asleep;
        Ok(())
    }

    pub fn is_awake(&self) -> bool {
        self.state != State::Asleep
    }

    fn reset(&mut self) -> Result<()> {
        self.rst.set_high()?;
        FreeRtos::delay_ms(20);
        self.rst.set_low()?;
        FreeRtos::delay_ms(2);
        self.rst.set_high()?;
        // As epd-waveshare does: less and the controller can miss the first commands.
        FreeRtos::delay_ms(200);
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
            FreeRtos::delay_ms(1);
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

    /// A command followed by a stream of data, sent in DMA-sized chunks.
    fn data_command(&mut self, command: u8, data: impl Iterator<Item = u8>) -> Result<()> {
        self.command(command, &[])?;
        self.dc.set_high()?;
        let mut chunk = Vec::with_capacity(CHUNK);
        for byte in data {
            chunk.push(byte);
            if chunk.len() == CHUNK {
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
