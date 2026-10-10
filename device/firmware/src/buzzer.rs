//! Passive piezo on D7 (GPIO 44), driven by LEDC: a short high beep when a key
//! is touched, two when a badge is accepted, a low one when something fails.

use anyhow::Result;
use esp_idf_svc::hal::{
    gpio::Gpio44,
    ledc::{config::TimerConfig, LedcDriver, LedcTimerDriver, CHANNEL0, TIMER0},
    units::FromValueType,
};
use esp_idf_svc::sys::{ledc_mode_t_LEDC_LOW_SPEED_MODE, ledc_set_freq, ledc_timer_t_LEDC_TIMER_0};
use matecrew_core::flow::Beep;
use std::{thread, time::Duration};

pub struct Buzzer {
    channel: LedcDriver<'static>,
}

impl Buzzer {
    pub fn new(
        timer: TIMER0<'static>,
        channel: CHANNEL0<'static>,
        pin: Gpio44<'static>,
    ) -> Result<Self> {
        let timer = LedcTimerDriver::new(timer, &TimerConfig::new().frequency(4.kHz().into()))?;
        let mut channel = LedcDriver::new(channel, timer, pin)?;
        channel.set_duty(0)?;
        Ok(Self { channel })
    }

    pub fn beep(&mut self, beep: Beep) {
        for &(hz, ms) in beep.tones() {
            if let Err(e) = self.tone(hz, ms) {
                log::warn!("buzzer: {e}");
                return;
            }
        }
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
