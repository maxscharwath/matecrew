import { prisma } from "@/lib/prisma";
import { normalizeUserCode } from "@/lib/device/codes";

/** The pending, unexpired link request behind a code a person typed, or null. */
export async function findPendingLink(input: string) {
  const userCode = normalizeUserCode(input);
  if (!userCode) return null;
  return prisma.deviceLink.findFirst({
    where: {
      userCode,
      expiresAt: { gt: new Date() },
      approvedAt: null,
      deniedAt: null,
      redeemedAt: null,
    },
  });
}
