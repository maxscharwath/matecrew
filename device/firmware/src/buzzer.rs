//! Passive piezo on D5 (GPIO 6), driven by LEDC: a short high beep when a key
//! is touched, two when a badge is accepted, a low one when something fails.
//!
//! Beeps play on a thread of their own, so a key beeps the moment it is
//! touched, even while the panel refreshes, and nothing waits for a tone.
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
    sync::{
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const PIN: i32 = 6;

/// Plays beeps one after another; cheap to clone, each clone queues on the same piezo.
#[derive(Clone)]
pub struct Buzzer {
    beeps: Sender<Beep>,
    /// When the last beep ended, `None` while one plays: the piezo then charges back to the
    /// divider's voltage.
    quiet_since: Arc<Mutex<Option<Instant>>>,
}

impl Buzzer {
    pub fn start(
        timer: TIMER0<'static>,
        channel: CHANNEL0<'static>,
        pin: Gpio6<'static>,
    ) -> Result<Self> {
        let timer = LedcTimerDriver::new(timer, &TimerConfig::new().frequency(4.kHz().into()))?;
        let mut channel = LedcDriver::new(channel, timer, pin)?;
        channel.set_duty(0)?;
        release()?;
        let (beeps, queue) = mpsc::channel::<Beep>();
        let quiet_since = Arc::new(Mutex::new(Some(Instant::now())));
        let quiet = quiet_since.clone();
        thread::Builder::new().stack_size(3072).spawn(move || {
            for beep in queue {
                *quiet.lock().unwrap() = None;
                play(&mut channel, beep);
                *quiet.lock().unwrap() = Some(Instant::now());
            }
        })?;
        Ok(Self { beeps, quiet_since })
    }

    /// Queues `beep`; returns at once.
    pub fn beep(&self, beep: Beep) {
        let _ = self.beeps.send(beep);
    }

    /// How long the piezo has been silent: zero while it plays.
    pub fn quiet(&self) -> Duration {
        self.quiet_since.lock().unwrap().map_or(Duration::ZERO, |at| at.elapsed())
    }
}

fn play(channel: &mut LedcDriver<'static>, beep: Beep) {
    // SAFETY: LEDC channel 0 drives GPIO 6 again; nothing else outputs on it.
    unsafe { esp_rom_gpio_connect_out_signal(PIN as u32, LEDC_LS_SIG_OUT0_IDX, false, false) };
    for &(hz, ms) in beep.tones() {
        if let Err(e) = tone(channel, hz, ms) {
            log::warn!("buzzer: {e}");
            break;
        }
    }
    if let Err(e) = release() {
        log::warn!("buzzer: {e}");
    }
}

/// Plays `hz` for `ms`; 0 Hz is a silence.
fn tone(channel: &mut LedcDriver<'static>, hz: u32, ms: u64) -> Result<()> {
    if hz > 0 {
        // The timer belongs to the channel driver, so its frequency is set through ESP-IDF.
        unsafe { ledc_set_freq(ledc_mode_t_LEDC_LOW_SPEED_MODE, ledc_timer_t_LEDC_TIMER_0, hz) };
        channel.set_duty(channel.get_max_duty() / 2)?;
    }
    thread::sleep(Duration::from_millis(ms));
    channel.set_duty(0)?;
    Ok(())
}

/// Lets D5 float, as the battery reading needs it.
fn release() -> Result<()> {
    // SAFETY: only turns GPIO 6's output and input off.
    esp!(unsafe { gpio_set_direction(PIN, gpio_mode_t_GPIO_MODE_DISABLE) })?;
    Ok(())
}
