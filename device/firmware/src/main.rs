use anyhow::{anyhow, Result};
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*};
use epd_waveshare::{
    color::Color,
    epd7in5_v2::{Epd7in5, HEIGHT, WIDTH},
    graphics::VarDisplay,
    prelude::*,
};
use esp_idf_svc::hal::{
    delay::Delay,
    gpio::{AnyIOPin, PinDriver, Pull},
    peripherals::Peripherals,
    spi::{config::Config, SpiDeviceDriver, SpiDriverConfig},
    units::FromValueType,
};
use std::time::Instant;

fn main() -> Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();
    log::info!("matecrew device: display test");

    let p = Peripherals::take()?;

    // ePaper Driver Board for XIAO. XIAO D-pin to GPIO: RST D0=1, CS D1=2, BUSY D2=3,
    // DC D3=4, SCK D8=7, MOSI D10=9. No MISO: D9 (GPIO8) is kept for the right key.
    let mut spi = SpiDeviceDriver::new_single(
        p.spi2,
        p.pins.gpio7,
        p.pins.gpio9,
        Option::<AnyIOPin>::None,
        Some(p.pins.gpio2),
        &SpiDriverConfig::new(),
        &Config::new().baudrate(4u32.MHz().into()),
    )?;
    let busy = PinDriver::input(p.pins.gpio3, Pull::Floating)?;
    let dc = PinDriver::output(p.pins.gpio4)?;
    let rst = PinDriver::output(p.pins.gpio1)?;
    let mut delay = Delay::new_default();

    let mut epd = Epd7in5::new(&mut spi, busy, dc, rst, &mut delay, None)?;

    let mut buffer = vec![0u8; (WIDTH / 8 * HEIGHT) as usize];
    let mut display = VarDisplay::<Color>::new(WIDTH, HEIGHT, &mut buffer, false)
        .map_err(|e| anyhow!("display buffer: {e:?}"))?;
    let _ = matecrew_ui::test_screen(&mut display.color_converted::<BinaryColor>());

    let start = Instant::now();
    epd.update_and_display_frame(&mut spi, display.buffer(), &mut delay)?;
    epd.sleep(&mut spi, &mut delay)?;
    log::info!("full refresh and sleep: {} ms", start.elapsed().as_millis());

    Ok(())
}
