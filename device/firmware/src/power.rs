//! The supply as the status bar shows it: the battery on D5 (GPIO 6, ADC1) through the
//! 1 MΩ / 1 MΩ divider, and USB. The XIAO's charger tells no GPIO when it charges; a USB host
//! (a computer) is seen by its frames on the USB-Serial-JTAG, a wall charger is not.
use matecrew_core::power::{battery_millivolts, Power};

/// Samples averaged per reading: the divider's 500 kΩ source is noisy.
const SAMPLES: u32 = 16;

pub struct Supply {
    /// One calibrated sample at D5 in millivolts (ADC1 channel 5, 12 dB, curve fitting).
    sample: Box<dyn FnMut() -> Option<u16>>,
    /// The last good reading, for a sample that fails.
    last: Option<u16>,
}

impl Supply {
    pub fn new(sample: Box<dyn FnMut() -> Option<u16>>) -> Self {
        Self { sample, last: None }
    }

    /// Battery voltage and USB now. A few milliseconds: called before each main screen.
    pub fn read(&mut self) -> Power {
        let samples: Vec<u32> = (0..SAMPLES).filter_map(|_| (self.sample)().map(u32::from)).collect();
        if !samples.is_empty() {
            let pin = samples.iter().sum::<u32>() / samples.len() as u32;
            self.last = Some(battery_millivolts(pin as u16));
        }
        Power {
            millivolts: self.last,
            // SAFETY: reads a flag the USB-Serial-JTAG driver keeps from the host's frames.
            usb: unsafe { esp_idf_svc::sys::usb_serial_jtag_is_connected() },
        }
    }
}
