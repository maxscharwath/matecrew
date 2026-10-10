//! PN532 NFC reader over I2C: SDA on D6 (GPIO 43), SCL on D7 (GPIO 44).
//! Only the badge UID is read. Frames are built and checked in
//! `matecrew_core::pn532`.

use anyhow::{anyhow, bail, Result};
use esp_idf_svc::hal::{
    delay::TickType,
    gpio::{AnyIOPin, Gpio43, Gpio44, PinDriver, Pull},
    i2c::{config::Config, I2cDriver, I2C0},
    uart::{self, UartDriver, UART1},
    units::FromValueType,
};
use matecrew_core::pn532::{self, ADDRESS};
use std::{
    thread,
    time::{Duration, Instant},
};

const BUS_TIMEOUT: Duration = Duration::from_millis(50);

pub struct Nfc {
    i2c: I2cDriver<'static>,
}

/// Why no PN532 answered, in the log: the idle level of D6 and D7 (a powered module pulls both
/// up) and the I2C addresses that answer, wired either way round.
pub fn diagnose() {
    // SAFETY: `Nfc::new` failed and dropped its driver: nothing else uses GPIO 43 and 44.
    let levels = (|| -> Result<(bool, bool)> {
        let sda = PinDriver::input(unsafe { Gpio43::steal() }, Pull::Down)?;
        let scl = PinDriver::input(unsafe { Gpio44::steal() }, Pull::Down)?;
        thread::sleep(Duration::from_millis(2));
        Ok((sda.is_high(), scl.is_high()))
    })();
    let level = |high: bool| if high { "high" } else { "low" };
    match levels {
        Ok((sda, scl)) => log::warn!(
            "nfc: idle D6 {} D7 {} (low: unpowered, unwired or no pull-up)",
            level(sda),
            level(scl)
        ),
        Err(e) => log::warn!("nfc: idle levels: {e:#}"),
    }
    for (wiring, swapped) in [("SDA D6 SCL D7", false), ("SDA D7 SCL D6", true)] {
        match scan(swapped) {
            Ok(found) => log::warn!("nfc: {wiring}: answers at {found:02x?}"),
            Err(e) => log::warn!("nfc: {wiring}: {e:#}"),
        }
        match serial(swapped) {
            Ok(reply) => log::warn!("nfc: {wiring}, serial (HSU) mode: {reply:02x?}"),
            Err(e) => log::warn!("nfc: {wiring}, serial (HSU) mode: {e:#}"),
        }
    }
}

/// What a PN532 left in serial (HSU) mode, its factory setting, answers to a firmware version
/// request at 115200 baud: its switches were not read as I2C.
fn serial(swapped: bool) -> Result<Vec<u8>> {
    // SAFETY: as in `diagnose`; nothing else uses UART1.
    let (port, d6, d7) = unsafe { (UART1::steal(), Gpio43::steal(), Gpio44::steal()) };
    let config = uart::config::Config::default().baudrate(115_200.Hz());
    let (none, unused) = (Option::<AnyIOPin>::None, Option::<AnyIOPin>::None);
    // The module's TXD is on its SDA pin, its RXD on SCL.
    let port = if swapped {
        UartDriver::new(port, d6, d7, none, unused, &config)?
    } else {
        UartDriver::new(port, d7, d6, none, unused, &config)?
    };
    let mut frame = vec![0x55, 0x55, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    frame.extend(pn532::command(pn532::GET_FIRMWARE_VERSION, &[]));
    port.write(&frame)?;
    let mut reply = [0u8; 32];
    let mut got = 0;
    let deadline = Instant::now() + Duration::from_millis(200);
    while Instant::now() < deadline && got < reply.len() {
        got += port.read(&mut reply[got..], TickType::from(Duration::from_millis(20)).ticks())?;
    }
    Ok(reply[..got].to_vec())
}

/// I2C addresses that acknowledge.
fn scan(swapped: bool) -> Result<Vec<u8>> {
    // SAFETY: as in `diagnose`; each driver is dropped before the next one.
    let (i2c, d6, d7) = unsafe { (I2C0::steal(), Gpio43::steal(), Gpio44::steal()) };
    let config = Config::new().baudrate(100.kHz().into());
    let mut bus = if swapped {
        I2cDriver::new(i2c, d7, d6, &config)?
    } else {
        I2cDriver::new(i2c, d6, d7, &config)?
    };
    let ticks = TickType::from(BUS_TIMEOUT).ticks();
    Ok((0x08..0x78).filter(|&address| bus.write(address, &[], ticks).is_ok()).collect())
}

impl Nfc {
    /// Fails when no PN532 answers, so the terminal can run without one.
    pub fn new(i2c: I2C0<'static>, sda: Gpio43<'static>, scl: Gpio44<'static>) -> Result<Self> {
        let i2c = I2cDriver::new(i2c, sda, scl, &Config::new().baudrate(100.kHz().into()))?;
        let mut nfc = Self { i2c };
        // The first transfer only wakes it up.
        let _ = nfc.i2c.write(ADDRESS, &[0x00], TickType::from(BUS_TIMEOUT).ticks());
        thread::sleep(Duration::from_millis(5));
        let version = nfc.command(pn532::GET_FIRMWARE_VERSION, &[], Duration::from_millis(500))?;
        log::info!("PN532 firmware {}.{}", version.get(1).unwrap_or(&0), version.get(2).unwrap_or(&0));
        nfc.command(pn532::SAM_CONFIGURATION, &pn532::SAM_NORMAL, Duration::from_millis(500))?;
        nfc.command(pn532::RF_CONFIGURATION, &pn532::FEW_RETRIES, Duration::from_millis(500))?;
        Ok(nfc)
    }

    /// UID of the badge on the reader, in uppercase hex, or `None` if there is none.
    pub fn read_uid(&mut self) -> Result<Option<String>> {
        let data = self.command(pn532::IN_LIST_PASSIVE_TARGET, &pn532::ONE_TYPE_A_TARGET, Duration::from_millis(500))?;
        Ok(pn532::target_uid(&data).map(pn532::hex))
    }

    fn command(&mut self, command: u8, params: &[u8], timeout: Duration) -> Result<Vec<u8>> {
        let ticks = TickType::from(BUS_TIMEOUT).ticks();
        self.i2c.write(ADDRESS, &pn532::command(command, params), ticks)?;

        let mut ack = [0u8; 1 + pn532::ACK.len()];
        self.wait_ready(&mut ack, Duration::from_millis(100))?;
        if !pn532::is_ack(&ack[1..]) {
            bail!("PN532 did not acknowledge command {command:#04x}");
        }

        let mut reply = [0u8; 64];
        self.wait_ready(&mut reply, timeout)?;
        pn532::response(&reply[1..], command)
            .map(<[u8]>::to_vec)
            .map_err(|e| anyhow!("PN532 answer to {command:#04x}: {e:?}"))
    }

    /// Reads until the status byte says ready; `buf[0]` is that status byte.
    fn wait_ready(&mut self, buf: &mut [u8], timeout: Duration) -> Result<()> {
        let ticks = TickType::from(BUS_TIMEOUT).ticks();
        let deadline = Instant::now() + timeout;
        loop {
            if self.i2c.read(ADDRESS, buf, ticks).is_ok() && buf[0] == pn532::READY {
                return Ok(());
            }
            if Instant::now() > deadline {
                bail!("PN532 not ready");
            }
            thread::sleep(Duration::from_millis(5));
        }
    }
}
