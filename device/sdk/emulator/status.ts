/**
 * `$device.status` as the terminal host adds it (device/ui/src/device_info.rs): Wi-Fi and
 * battery sprites (24 px Lucide, 2 px strokes) and the battery text, from raw readings.
 * The studio and previews use it so the status bar shows what the panel will.
 */
import {
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  BatteryWarningIcon,
  PlugZapIcon,
  WifiHighIcon,
  WifiIcon,
  WifiLowIcon,
  WifiOffIcon,
  WifiZeroIcon,
} from "../icons/lucide";
import type { IconComponent } from "../icons/factory";

const bits = (icon: IconComponent) => {
  const image = icon({ size: 24 });
  return image.kind === "image" && "literal" in image.value ? (image.value.literal as number[]) : [];
};

/** At or under this charge, off USB, the status bar warns (device/core/src/power.rs). */
export const LOW_PERCENT = 10;
/** The curve's last point: an empty cell (mV, %). */
const EMPTY: [number, number] = [3270, 0];
/** Open-circuit voltage of a 1S LiPo against its charge (mV, %), from full to empty. */
const CURVE: [number, number][] = [
  [4200, 100], [4150, 95], [4110, 90], [4080, 85], [4020, 80], [3980, 75], [3950, 70],
  [3910, 65], [3870, 60], [3850, 55], [3840, 50], [3820, 45], [3800, 40], [3790, 35],
  [3770, 30], [3750, 25], [3730, 20], [3710, 15], [3690, 10], [3610, 5], EMPTY,
];

/** Charge in percent for a battery voltage, as the terminal computes it. */
export function batteryPercent(millivolts: number): number | null {
  if (!(millivolts >= 2500 && millivolts <= 4500)) return null;
  if (millivolts >= CURVE[0][0]) return 100;
  for (let i = 1; i < CURVE.length; i++) {
    const [loMv, lo] = CURVE[i];
    if (millivolts >= loMv) {
      const [hiMv, hi] = CURVE[i - 1];
      return lo + Math.floor(((hi - lo) * (millivolts - loMv) + Math.floor((hiMv - loMv) / 2)) / (hiMv - loMv));
    }
  }
  return 0;
}

/** The resting voltage for a charge: where the studio puts its battery slider for a preview. */
export function batteryMillivolts(percent: number): number {
  const p = Math.max(0, Math.min(100, percent));
  for (let i = 1; i < CURVE.length; i++) {
    const [loMv, lo] = CURVE[i];
    if (p >= lo) {
      const [hiMv, hi] = CURVE[i - 1];
      return Math.round(loMv + ((hiMv - loMv) * (p - lo)) / (hi - lo));
    }
  }
  return EMPTY[0];
}

type Battery = { millivolts?: number | null; percent?: number | null; usb?: boolean; charging?: boolean };

/** The charge the host reports when it is a percentage, else the one its voltage gives. */
function chargeOf({ percent }: Battery, millivolts: number | null): number | null {
  if (typeof percent === "number" && percent >= 0 && percent <= 100) return Math.round(percent);
  return millivolts === null ? null : batteryPercent(millivolts);
}

/** The Wi-Fi sprite for a signal in dBm; none without a connection. */
function wifiIcon(rssi: number | null | undefined): IconComponent {
  if (typeof rssi !== "number") return WifiOffIcon;
  if (rssi >= -55) return WifiIcon;
  if (rssi >= -70) return WifiHighIcon;
  if (rssi >= -85) return WifiLowIcon;
  return WifiZeroIcon;
}

/** The battery sprite: the plug first, then the charge in thirds, a warning when low. */
function batteryIcon(percent: number | null, usb: boolean, charging: boolean): IconComponent {
  if (charging) return BatteryChargingIcon;
  if (usb) return PlugZapIcon;
  if (percent === null) return BatteryIcon;
  if (percent <= LOW_PERCENT) return BatteryWarningIcon;
  if (percent > 66) return BatteryFullIcon;
  if (percent > 33) return BatteryMediumIcon;
  return BatteryLowIcon;
}

/** The charge as text; nothing on USB when it is unknown. */
function batteryText(percent: number | null, usb: boolean): string {
  if (percent !== null) return `${percent}%`;
  return usb ? "" : "--";
}

/** Raw host readings plus the `status` the kit's status bar binds to. */
export function decorate(info: Record<string, unknown>): Record<string, unknown> {
  const rssi = (info.wifi as { rssi?: number | null } | undefined)?.rssi;
  const reading = (info.battery ?? {}) as Battery;
  const millivolts = typeof reading.millivolts === "number" ? reading.millivolts : null;
  const usb = reading.usb === true || reading.charging === true;
  const percent = chargeOf(reading, millivolts);
  // Charging only when the charge is known; otherwise the plug alone, as on the terminal.
  const charging = usb && percent !== null && percent < 100;
  const low = !usb && percent !== null && percent <= LOW_PERCENT;
  return {
    ...info,
    battery: { millivolts, percent, usb, charging, low },
    status: {
      wifi: bits(wifiIcon(rssi)),
      battery: bits(batteryIcon(percent, usb, charging)),
      batteryUnknown: percent === null ? "?" : "",
      batteryText: batteryText(percent, usb),
      charging,
      low,
    },
  };
}
