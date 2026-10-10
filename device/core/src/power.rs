//! The terminal's supply: the LiPo's charge from its voltage, and whether USB powers the board.
//!
//! The battery is read on D5 through a 1 MΩ / 1 MΩ divider (half of BAT+). The XIAO charges it
//! from USB-C; its charger reports nothing to a GPIO, so "on USB" means a USB host answers on the
//! USB-Serial-JTAG (a computer). A wall charger is only seen through the voltage.
use serde_json::{json, Value};

/// BAT+ over the voltage at D5, in thousandths: the 1 MΩ / 1 MΩ divider, to calibrate on a board
/// against a multimeter (`2000` = exactly half).
pub const DIVIDER_PERMILLE: u32 = 2000;
/// At or under this charge, off USB, the status bar warns.
pub const LOW_PERCENT: u8 = 10;

/// Open-circuit voltage of a 1S LiPo against its charge (mV, %), from full to empty.
const CURVE: [(u16, u8); 21] = [
    (4200, 100),
    (4150, 95),
    (4110, 90),
    (4080, 85),
    (4020, 80),
    (3980, 75),
    (3950, 70),
    (3910, 65),
    (3870, 60),
    (3850, 55),
    (3840, 50),
    (3820, 45),
    (3800, 40),
    (3790, 35),
    (3770, 30),
    (3750, 25),
    (3730, 20),
    (3710, 15),
    (3690, 10),
    (3610, 5),
    (3270, 0),
];

/// Readings outside this window are a disconnected divider or no battery, not a charge.
const PLAUSIBLE_MV: core::ops::RangeInclusive<u16> = 2500..=4500;

/// BAT+ in millivolts from the calibrated voltage at D5.
pub fn battery_millivolts(pin_mv: u16) -> u16 {
    (u32::from(pin_mv) * DIVIDER_PERMILLE / 1000).min(u32::from(u16::MAX)) as u16
}

/// Charge in percent, interpolated on the LiPo curve.
pub fn percent(millivolts: u16) -> u8 {
    let (top, empty) = (CURVE[0], CURVE[CURVE.len() - 1]);
    if millivolts >= top.0 {
        return 100;
    }
    if millivolts <= empty.0 {
        return 0;
    }
    CURVE
        .windows(2)
        .find(|w| millivolts >= w[1].0)
        .map_or(0, |w| {
            let ((hi_mv, hi), (lo_mv, lo)) = (w[0], w[1]);
            let span = u32::from(hi_mv - lo_mv);
            let above = u32::from(millivolts - lo_mv);
            (u32::from(lo) + (u32::from(hi - lo) * above + span / 2) / span) as u8
        })
}

/// One reading of the supply.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Power {
    /// BAT+, divider undone; `None` when the ADC failed.
    pub millivolts: Option<u16>,
    /// A USB host powers the board, so the battery charges.
    pub usb: bool,
}

impl Power {
    /// Charge in percent; `None` without a plausible reading.
    pub fn percent(&self) -> Option<u8> {
        self.plausible_millivolts().map(percent)
    }

    /// BAT+ when it reads like a battery; `None` without the divider on D5 (the pin floats).
    pub fn plausible_millivolts(&self) -> Option<u16> {
        self.millivolts.filter(|mv| PLAUSIBLE_MV.contains(mv))
    }
    /// On USB and not full yet. The charger lifts the voltage, so the charge reads high meanwhile.
    pub fn charging(&self) -> bool {
        self.usb && self.percent().is_none_or(|p| p < 100)
    }
    /// Running on a battery that needs charging.
    pub fn low(&self) -> bool {
        !self.usb && self.percent().is_some_and(|p| p <= LOW_PERCENT)
    }
    /// `$device.battery`, as the hosts and the status bar read it.
    pub fn json(&self) -> Value {
        json!({
            "millivolts": self.plausible_millivolts(),
            "percent": self.percent(),
            "usb": self.usb,
            "charging": self.charging(),
            "low": self.low(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn charge_follows_the_lipo_curve() {
        assert_eq!(percent(4250), 100);
        assert_eq!(percent(4200), 100);
        assert_eq!(percent(3840), 50);
        assert_eq!(percent(3845), 53);
        assert_eq!(percent(3690), 10);
        assert_eq!(percent(3500), 3);
        assert_eq!(percent(3270), 0);
        assert_eq!(percent(3000), 0);
        let mut last = 0;
        for mv in (3200..=4250).step_by(5) {
            let p = percent(mv);
            assert!(p >= last, "{mv} mV: {p} % after {last} %");
            last = p;
        }
    }

    #[test]
    fn divider_doubles_the_pin_voltage() {
        assert_eq!(battery_millivolts(1975), 3950);
        assert_eq!(battery_millivolts(u16::MAX), u16::MAX);
    }

    #[test]
    fn usb_charges_until_full_and_low_needs_battery_power() {
        let charging = Power { millivolts: Some(4000), usb: true };
        assert!(charging.charging() && !charging.low());
        let full = Power { millivolts: Some(4210), usb: true };
        assert!(!full.charging());
        let low = Power { millivolts: Some(3600), usb: false };
        assert!(low.low() && !low.charging());
        assert_eq!(low.json()["percent"], 5);
        let unplugged = Power { millivolts: Some(1200), usb: false };
        assert_eq!(unplugged.percent(), None);
        assert!(!unplugged.low());
        assert_eq!(Power::default().json()["percent"], Value::Null);
    }
}
