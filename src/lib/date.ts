/**
 * Returns today's date with time zeroed to midnight UTC.
 * Matches Prisma's @db.Date storage format.
 */
export function getTodayDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Formats a date for display: "3 mars 2026" style using fr-CH locale.
 */
export function formatDateDisplay(date: Date): string {
  return date.toLocaleDateString("fr-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Returns "YYYY-MM-DD" string for URL params and API use.
 */
export function toISODateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
