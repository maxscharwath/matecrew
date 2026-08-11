import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { SCHEDULE_STEP_MINUTES, timeToMinutes } from "@/lib/date";
import { trySyncSessionSchedules } from "@/lib/schedule-sync";
import { McpToolError, resolveAdminOffice } from "@/lib/mcp/context";
import { notifyQuietly } from "@/lib/mcp/notify";
import { defineTool } from "@/lib/mcp/tool";
import { DAY_NAMES, dayOfWeekArg, officeArg, timeArg } from "@/lib/mcp/schemas";

const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * Session times must land on a 5-minute boundary: the cron that fires the Slack
 * announcement scans in 5-minute steps, so an off-grid time would be missed.
 */
function validateWindow(startTime: string, cutoffTime: string): void {
  if (!TIME_RE.test(startTime) || !TIME_RE.test(cutoffTime)) {
    throw new McpToolError("Times must be 24-hour HH:mm, e.g. 09:30.");
  }
  for (const [label, time] of [
    ["Start", startTime],
    ["Cutoff", cutoffTime],
  ] as const) {
    if (timeToMinutes(time) % SCHEDULE_STEP_MINUTES !== 0) {
      throw new McpToolError(
        `${label} time ${time} must be on a ${SCHEDULE_STEP_MINUTES}-minute boundary (e.g. 09:30, 09:35).`,
      );
    }
  }
  if (timeToMinutes(startTime) >= timeToMinutes(cutoffTime)) {
    throw new McpToolError(
      `Start time ${startTime} must be before the cutoff ${cutoffTime}.`,
    );
  }
}

/** Two sessions on the same day may not overlap — orders would be ambiguous. */
async function assertNoOverlap(
  officeId: string,
  dayOfWeek: number,
  startTime: string,
  cutoffTime: string,
  excludeId?: string,
): Promise<void> {
  const existing = await prisma.mateSession.findMany({
    where: {
      officeId,
      dayOfWeek,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { label: true, startTime: true, cutoffTime: true },
  });

  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(cutoffTime);

  for (const s of existing) {
    if (newStart < timeToMinutes(s.cutoffTime) && timeToMinutes(s.startTime) < newEnd) {
      throw new McpToolError(
        `That overlaps the existing session ${s.label ?? ""} ${s.startTime}-${s.cutoffTime} on ${DAY_NAMES[dayOfWeek]}.`,
      );
    }
  }
}

export function registerAdminScheduleTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_admin_add_session",
      title: "Add a weekly session",
      description:
        "Add a recurring maté session. At `startTime` MateCrew posts the ordering message to Slack; at `cutoffTime` orders close. Times are in the office timezone and must sit on a 5-minute boundary. Sessions on the same day cannot overlap.",
      inputSchema: {
        office: officeArg,
        dayOfWeek: dayOfWeekArg,
        startTime: timeArg.describe(
          "When the session opens and the Slack announcement is posted, HH:mm.",
        ),
        cutoffTime: timeArg.describe("When ordering closes, HH:mm."),
        label: z
          .string()
          .max(60)
          .optional()
          .describe("Optional name, e.g. 'Morning' or 'Afternoon'."),
      },
    },
    async ({ office, dayOfWeek, startTime, cutoffTime, label }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      validateWindow(startTime, cutoffTime);
      await assertNoOverlap(scope.officeId, dayOfWeek, startTime, cutoffTime);

      const session = await prisma.mateSession.create({
        data: {
          officeId: scope.officeId,
          dayOfWeek,
          startTime,
          cutoffTime,
          label: label?.trim() || null,
        },
        select: { id: true },
      });

      // Keeps the QStash crons that fire the Slack messages in step with the DB.
      await notifyQuietly("schedule-sync", () => trySyncSessionSchedules());

      return {
        ok: true,
        sessionId: session.id,
        day: DAY_NAMES[dayOfWeek],
        startTime,
        cutoffTime,
        label: label?.trim() || null,
        message: `Added a ${DAY_NAMES[dayOfWeek]} session from ${startTime} to ${cutoffTime} in ${scope.officeName}.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_update_session",
      title: "Change a weekly session",
      description:
        "Move or rename an existing recurring session. Only the fields you pass change; the new window must still be valid and must not overlap another session that day.",
      inputSchema: {
        office: officeArg,
        sessionId: z
          .string()
          .describe("Session id from matecrew_get_schedule."),
        dayOfWeek: dayOfWeekArg.optional(),
        startTime: timeArg.optional(),
        cutoffTime: timeArg.optional(),
        label: z
          .string()
          .max(60)
          .optional()
          .describe("New label. Pass an empty string to clear it."),
      },
      idempotent: true,
    },
    async (
      { office, sessionId, dayOfWeek, startTime, cutoffTime, label },
      { actor },
    ) => {
      const scope = await resolveAdminOffice(actor, office);

      const session = await prisma.mateSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          officeId: true,
          dayOfWeek: true,
          startTime: true,
          cutoffTime: true,
        },
      });
      if (!session || session.officeId !== scope.officeId) {
        throw new McpToolError(
          `No session with id ${sessionId} in ${scope.officeName}.`,
        );
      }

      const nextDay = dayOfWeek ?? session.dayOfWeek;
      const nextStart = startTime ?? session.startTime;
      const nextCutoff = cutoffTime ?? session.cutoffTime;

      validateWindow(nextStart, nextCutoff);
      await assertNoOverlap(
        scope.officeId,
        nextDay,
        nextStart,
        nextCutoff,
        session.id,
      );

      const updated = await prisma.mateSession.update({
        where: { id: sessionId },
        data: {
          dayOfWeek: nextDay,
          startTime: nextStart,
          cutoffTime: nextCutoff,
          ...(label === undefined ? {} : { label: label.trim() || null }),
        },
        select: { id: true, dayOfWeek: true, startTime: true, cutoffTime: true, label: true },
      });

      await notifyQuietly("schedule-sync", () => trySyncSessionSchedules());

      return {
        ok: true,
        session: { ...updated, day: DAY_NAMES[updated.dayOfWeek] },
        message: `Session now runs ${DAY_NAMES[updated.dayOfWeek]} ${updated.startTime}-${updated.cutoffTime}.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_remove_session",
      title: "Remove a weekly session",
      description:
        "Delete a recurring session so no further announcements go out for it. Orders already placed against it are kept and stay linked to their date.",
      inputSchema: {
        office: officeArg,
        sessionId: z.string().describe("Session id to delete."),
      },
      destructive: true,
      idempotent: true,
    },
    async ({ office, sessionId }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);

      const session = await prisma.mateSession.findUnique({
        where: { id: sessionId },
        select: {
          officeId: true,
          dayOfWeek: true,
          startTime: true,
          cutoffTime: true,
        },
      });
      if (!session || session.officeId !== scope.officeId) {
        throw new McpToolError(
          `No session with id ${sessionId} in ${scope.officeName}.`,
        );
      }

      await prisma.mateSession.delete({ where: { id: sessionId } });
      await notifyQuietly("schedule-sync", () => trySyncSessionSchedules());

      return {
        ok: true,
        message: `Removed the ${DAY_NAMES[session.dayOfWeek]} ${session.startTime}-${session.cutoffTime} session from ${scope.officeName}.`,
      };
    },
  );
}
