"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import { generateReimbursementCsv } from "@/lib/csv-export";

const CreatePeriodSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((d) => d.endDate > d.startDate, {
    message: "End date must be after start date",
  });

type ActionResult = { success: true } | { success: false; error: string };

export async function createReimbursementPeriod(
  officeId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");

  const parsed = CreatePeriodSchema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { startDate, endDate } = parsed.data;

  // Check for overlapping open periods
  const overlap = await prisma.reimbursementPeriod.findFirst({
    where: {
      officeId,
      closedAt: null,
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
  });

  if (overlap) {
    return {
      success: false,
      error: "An open period already overlaps with this date range.",
    };
  }

  const result = await calculateReimbursements(officeId, startDate, endDate);

  await prisma.reimbursementPeriod.create({
    data: {
      officeId,
      startDate,
      endDate,
      lines: {
        create: result.lines.map((l) => ({
          fromUserId: l.fromUserId,
          toUserId: l.toUserId,
          amount: l.amount,
          currency: "CHF",
        })),
      },
    },
  });

  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  return { success: true };
}

export async function closePeriod(
  officeId: string,
  periodId: string
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");

  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
  });

  if (!period || period.officeId !== officeId) {
    return { success: false, error: "Period not found." };
  }

  if (period.closedAt) {
    return { success: false, error: "Period is already closed." };
  }

  await prisma.reimbursementPeriod.update({
    where: { id: periodId },
    data: { closedAt: new Date() },
  });

  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  return { success: true };
}

export async function recalculatePeriod(
  officeId: string,
  periodId: string
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");

  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
  });

  if (!period || period.officeId !== officeId) {
    return { success: false, error: "Period not found." };
  }

  if (period.closedAt) {
    return { success: false, error: "Cannot recalculate a closed period." };
  }

  const result = await calculateReimbursements(
    officeId,
    period.startDate,
    period.endDate
  );

  await prisma.$transaction([
    prisma.reimbursementLine.deleteMany({ where: { periodId } }),
    ...result.lines.map((l) =>
      prisma.reimbursementLine.create({
        data: {
          periodId,
          fromUserId: l.fromUserId,
          toUserId: l.toUserId,
          amount: l.amount,
          currency: "CHF",
        },
      })
    ),
  ]);

  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  return { success: true };
}

export async function deletePeriod(
  officeId: string,
  periodId: string
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");

  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
  });

  if (!period || period.officeId !== officeId) {
    return { success: false, error: "Period not found." };
  }

  if (period.closedAt) {
    return { success: false, error: "Cannot delete a closed period." };
  }

  await prisma.$transaction([
    prisma.reimbursementLine.deleteMany({ where: { periodId } }),
    prisma.reimbursementPeriod.delete({ where: { id: periodId } }),
  ]);

  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  return { success: true };
}

export async function exportPeriodCsv(
  officeId: string,
  periodId: string
): Promise<{ success: true; csv: string } | { success: false; error: string }> {
  await requireOrgRoles(officeId, "ADMIN");

  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
    include: { office: { select: { name: true } } },
  });

  if (!period || period.officeId !== officeId) {
    return { success: false, error: "Period not found." };
  }

  const result = await calculateReimbursements(
    officeId,
    period.startDate,
    period.endDate
  );

  const csv = generateReimbursementCsv({
    officeName: period.office.name,
    startDate: period.startDate,
    endDate: period.endDate,
    totalConsumption: result.totalConsumption,
    totalCost: result.totalCost,
    shares: result.shares,
    lines: result.lines,
  });

  return { success: true, csv };
}
