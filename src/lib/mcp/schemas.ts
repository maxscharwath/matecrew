import { z } from "zod";
import { McpToolError } from "@/lib/mcp/context";

/** Argument pieces shared across MateCrew's MCP tools. */

export const officeArg = z
  .string()
  .optional()
  .describe(
    "Office id or office name. Omit to use your default office (or your only office).",
  );

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isoDateArg = z
  .string()
  .regex(ISO_DATE, "Use YYYY-MM-DD")
  .describe("Calendar date as YYYY-MM-DD.");

/**
 * Parses "YYYY-MM-DD" into the UTC-midnight `Date` that Prisma's `@db.Date`
 * columns store, matching `getTodayDate()` in `@/lib/date`.
 */
export function parseIsoDate(value: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new McpToolError(`"${value}" is not a valid date. Use YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new McpToolError(`"${value}" is not a valid date.`);
  }
  return date;
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const dayOfWeekArg = z
  .number()
  .int()
  .min(0)
  .max(6)
  .describe("Day of week: 0=Sunday, 1=Monday ... 6=Saturday.");

export const timeArg = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Use 24-hour HH:mm")
  .describe("Time of day as 24-hour HH:mm in the office timezone.");
