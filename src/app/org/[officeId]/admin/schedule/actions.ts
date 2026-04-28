"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { timeToMinutes, SCHEDULE_STEP_MINUTES } from "@/lib/date";
import { trySyncSessionSchedules } from "@/lib/schedule-sync";
type ActionResult = { success: true } | { success: false; error: string };

const TIME_RE = /^\d{2}:\d{2}$/;

async function validateTimeAlignment(time: string, fieldLabel: string): Promise<string | null> {
  const t = await getTranslations();
  const mins = timeToMinutes(time);
  if (mins % SCHEDULE_STEP_MINUTES !== 0) {
    return t('errors.timeAlignment', { field: fieldLabel, step: SCHEDULE_STEP_MINUTES });
  }
  return null;
}

async function validateTimeRange(startTime: string, cutoffTime: string): Promise<string | null> {
  const t = await getTranslations();
  if (!TIME_RE.test(startTime) || !TIME_RE.test(cutoffTime)) {
    return t('errors.invalidTimeFormat');
  }

  const alignStart = await validateTimeAlignment(startTime, t('schedule.start'));
  if (alignStart) return alignStart;

  const alignCutoff = await validateTimeAlignment(cutoffTime, t('schedule.close'));
  if (alignCutoff) return alignCutoff;

  if (timeToMinutes(startTime) >= timeToMinutes(cutoffTime)) {
    return t('errors.startBeforeClose');
  }
  return null;
}

async function checkOverlap(
  officeId: string,
  dayOfWeek: number,
  startTime: string,
  cutoffTime: string,
  excludeId?: string,
): Promise<string | null> {
  const existing = await prisma.mateSession.findMany({
    where: { officeId, dayOfWeek, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });

  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(cutoffTime);

  for (const s of existing) {
    const sStart = timeToMinutes(s.startTime);
    const sEnd = timeToMinutes(s.cutoffTime);
    if (newStart < sEnd && sStart < newEnd) {
      const t = await getTranslations();
      return t('errors.sessionOverlap', { label: s.label ?? "", start: s.startTime, end: s.cutoffTime });
    }
  }

  return null;
}

export async function addSession(
  officeId: string,
  dayOfWeek: number,
  startTime: string,
  cutoffTime: string,
  label: string,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");

  const t = await getTranslations();

  if (dayOfWeek < 0 || dayOfWeek > 6) {
    return { success: false, error: t('errors.invalidDay') };
  }

  const timeError = await validateTimeRange(startTime, cutoffTime);
  if (timeError) return { success: false, error: timeError };

  const overlapError = await checkOverlap(officeId, dayOfWeek, startTime, cutoffTime);
  if (overlapError) return { success: false, error: overlapError };

  await prisma.mateSession.create({
    data: {
      officeId,
      dayOfWeek,
      startTime,
      cutoffTime,
      label: label.trim() || null,
    },
  });

  await trySyncSessionSchedules();
  revalidatePath(`/org/${officeId}/admin/schedule`);
  return { success: true };
}

export async function removeSession(
  officeId: string,
  sessionId: string,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");

  const session = await prisma.mateSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.officeId !== officeId) {
    const t = await getTranslations();
    return { success: false, error: t('errors.sessionNotFound') };
  }

  await prisma.mateSession.delete({ where: { id: sessionId } });

  await trySyncSessionSchedules();
  revalidatePath(`/org/${officeId}/admin/schedule`);
  return { success: true };
}

export async function updateSession(
  officeId: string,
  sessionId: string,
  startTime: string,
  cutoffTime: string,
  label: string,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");

  const session = await prisma.mateSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.officeId !== officeId) {
    const t = await getTranslations();
    return { success: false, error: t('errors.sessionNotFound') };
  }

  const timeError = await validateTimeRange(startTime, cutoffTime);
  if (timeError) return { success: false, error: timeError };

  const overlapError = await checkOverlap(
    officeId,
    session.dayOfWeek,
    startTime,
    cutoffTime,
    sessionId,
  );
  if (overlapError) return { success: false, error: overlapError };

  await prisma.mateSession.update({
    where: { id: sessionId },
    data: {
      startTime,
      cutoffTime,
      label: label.trim() || null,
    },
  });

  await trySyncSessionSchedules();
  revalidatePath(`/org/${officeId}/admin/schedule`);
  return { success: true };
}

export async function copyDaySchedule(
  officeId: string,
  fromDay: number,
  toDays: number[],
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");

  const sourceSessions = await prisma.mateSession.findMany({
    where: { officeId, dayOfWeek: fromDay },
    orderBy: { startTime: "asc" },
  });

  if (sourceSessions.length === 0) {
    const t = await getTranslations();
    const dayLabel = t(`schedule.dayLabels.${fromDay}`);
    return { success: false, error: t('errors.noSessionOnDay', { day: dayLabel }) };
  }

  for (const targetDay of toDays) {
    if (targetDay < 0 || targetDay > 6 || targetDay === fromDay) continue;

    // Delete existing sessions on target day
    await prisma.mateSession.deleteMany({
      where: { officeId, dayOfWeek: targetDay },
    });

    // Copy sessions
    for (const s of sourceSessions) {
      await prisma.mateSession.create({
        data: {
          officeId,
          dayOfWeek: targetDay,
          startTime: s.startTime,
          cutoffTime: s.cutoffTime,
          label: s.label,
        },
      });
    }
  }

  await trySyncSessionSchedules();
  revalidatePath(`/org/${officeId}/admin/schedule`);
  return { success: true };
}

