//! PN532 NFC reader over I2C: SDA on IO41, SCL on IO42 (pads under the XIAO).
//! Only the badge UID is read. Frames are built and checked in
//! `matecrew_core::pn532`.

use anyhow::{anyhow, bail, Result};
use esp_idf_svc::hal::{
    delay::TickType,
    gpio::{Gpio41, Gpio42},
    i2c::{config::Config, I2cDriver, I2C0},
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

impl Nfc {
    /// Fails when no PN532 answers, so the terminal can run without one.
    pub fn new(i2c: I2C0<'static>, sda: Gpio41<'static>, scl: Gpio42<'static>) -> Result<Self> {
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
