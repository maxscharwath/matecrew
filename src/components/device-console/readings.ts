/**
 * The terminal's sensors as it computes them (device/core/src/power.rs,
 * device/sdk/emulator/status.ts): charge from the LiPo curve, signal bands.
 */

/** Open-circuit voltage of a 1S LiPo against its charge (mV, %), from full to empty. */
const CURVE: [number, number][] = [
  [4200, 100], [4150, 95], [4110, 90], [4080, 85], [4020, 80], [3980, 75], [3950, 70],
  [3910, 65], [3870, 60], [3850, 55], [3840, 50], [3820, 45], [3800, 40], [3790, 35],
  [3770, 30], [3750, 25], [3730, 20], [3710, 15], [3690, 10], [3610, 5], [3270, 0],
];
/** At or under this charge the terminal's status bar warns. */
export const LOW_PERCENT = 10;

/**
 * Voltage and charge, or null when the reading is no battery's: without the
 * divider on D5 the pin floats and reports anything.
 */
export function battery(millivolts: number | null): { millivolts: number; percent: number; low: boolean } | null {
  if (millivolts === null || !(millivolts >= 2500 && millivolts <= 4500)) return null;
  let percent = 0;
  if (millivolts >= CURVE[0][0]) percent = 100;
  else
    for (let i = 1; i < CURVE.length; i++) {
      const [loMv, lo] = CURVE[i];
      if (millivolts >= loMv) {
        const [hiMv, hi] = CURVE[i - 1];
        percent = lo + Math.floor(((hi - lo) * (millivolts - loMv) + Math.floor((hiMv - loMv) / 2)) / (hiMv - loMv));
        break;
      }
    }
  return { millivolts, percent, low: percent <= LOW_PERCENT };
}

export type SignalBand = "excellent" | "good" | "fair" | "weak";

/** The bands the terminal's Wi-Fi icon uses. */
export function signalBand(rssi: number): SignalBand {
  return rssi >= -55 ? "excellent" : rssi >= -70 ? "good" : rssi >= -85 ? "fair" : "weak";
}
