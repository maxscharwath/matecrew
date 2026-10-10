/**
 * `Device.syncTimes`: the local times ("HH:MM", office timezone) at which a
 * terminal syncs, stored comma-separated ("08:00,12:00,15:00,18:00") because
 * the schema keeps to columns every database has.
 */

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The times in the column, in stored order; blanks and anything that is not "HH:MM" are dropped. */
export function parseSyncTimes(value: string): string[] {
  return value
    .split(",")
    .map((time) => time.trim())
    .filter((time) => HH_MM.test(time));
}

/** The column value for `times`; throws on a time that is not "HH:MM". */
export function formatSyncTimes(times: readonly string[]): string {
  const invalid = times.find((time) => !HH_MM.test(time));
  if (invalid !== undefined) throw new RangeError(`Not an HH:MM time: "${invalid}"`);
  return times.join(",");
}
