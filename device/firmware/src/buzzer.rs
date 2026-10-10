//! Passive piezo on D5 (GPIO 6), driven by LEDC: a short high beep when a key
//! is touched, two when a badge is accepted, a low one when something fails.
//!
//! D5 also reads the battery through its 1 MΩ / 1 MΩ divider. A piezo passes no direct current,
//! so it does not change that reading: the pin is the LEDC output only while a beep plays and
//! floats the rest of the time.

use anyhow::Result;
use esp_idf_svc::hal::{
    gpio::Gpio6,
    ledc::{config::TimerConfig, LedcDriver, LedcTimerDriver, CHANNEL0, TIMER0},
    units::FromValueType,
};
use esp_idf_svc::sys::{
    esp, esp_rom_gpio_connect_out_signal, gpio_mode_t_GPIO_MODE_DISABLE, gpio_set_direction,
    ledc_mode_t_LEDC_LOW_SPEED_MODE, ledc_set_freq, ledc_timer_t_LEDC_TIMER_0, LEDC_LS_SIG_OUT0_IDX,
};
use matecrew_core::flow::Beep;
use std::{
    thread,
    time::{Duration, Instant},
};

const PIN: i32 = 6;

pub struct Buzzer {
    channel: LedcDriver<'static>,
    /// When the last beep ended: the piezo then charges back to the divider's voltage.
    quiet_since: Instant,
    /// A key press already beeped: the key beep its screen asks for is that one.
    pressed: bool,
}

impl Buzzer {
    pub fn new(
        timer: TIMER0<'static>,
        channel: CHANNEL0<'static>,
        pin: Gpio6<'static>,
    ) -> Result<Self> {
        let timer = LedcTimerDriver::new(timer, &TimerConfig::new().frequency(4.kHz().into()))?;
        let mut channel = LedcDriver::new(channel, timer, pin)?;
        channel.set_duty(0)?;
        release()?;
        Ok(Self { channel, quiet_since: Instant::now(), pressed: false })
    }

    /// Every key press beeps as soon as it is read, whatever the screen does with it, until
    /// `handled`.
    pub fn press(&mut self) {
        self.beep(Beep::Key);
        self.pressed = true;
    }

    pub fn handled(&mut self) {
        self.pressed = false;
    }

    pub fn beep(&mut self, beep: Beep) {
        if self.pressed && beep == Beep::Key {
            return;
        }
        // SAFETY: LEDC channel 0 drives GPIO 6 again; nothing else outputs on it.
        unsafe { esp_rom_gpio_connect_out_signal(PIN as u32, LEDC_LS_SIG_OUT0_IDX, false, false) };
        for &(hz, ms) in beep.tones() {
            if let Err(e) = self.tone(hz, ms) {
                log::warn!("buzzer: {e}");
                break;
            }
        }
        if let Err(e) = release() {
            log::warn!("buzzer: {e}");
        }
        self.quiet_since = Instant::now();
    }

    /// How long the piezo has been silent.
    pub fn quiet(&self) -> Duration {
        self.quiet_since.elapsed()
    }

    /// Plays `hz` for `ms`; 0 Hz is a silence.
    fn tone(&mut self, hz: u32, ms: u64) -> Result<()> {
        if hz > 0 {
            // The timer belongs to the channel driver, so its frequency is set through ESP-IDF.
            unsafe {
                ledc_set_freq(
                    ledc_mode_t_LEDC_LOW_SPEED_MODE,
                    ledc_timer_t_LEDC_TIMER_0,
                    hz,
                )
            };
            self.channel.set_duty(self.channel.get_max_duty() / 2)?;
        }
        thread::sleep(Duration::from_millis(ms));
        self.channel.set_duty(0)?;
        Ok(())
    }
}

/// Lets D5 float, as the battery reading needs it.
fn release() -> Result<()> {
    // SAFETY: only turns GPIO 6's output and input off.
    esp!(unsafe { gpio_set_direction(PIN, gpio_mode_t_GPIO_MODE_DISABLE) })?;
    Ok(())
}
