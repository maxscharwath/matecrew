import "server-only";
import { prisma } from "@/lib/prisma";
import { getTodayDate } from "@/lib/date";
import { resolveAvatarUrl } from "@/lib/storage";

export interface ForgottenOrder {
  id: string;
  date: Date;
  user: { id: string; name: string; email: string; image: string | undefined };
  session: {
    id: string;
    label: string | null;
    startTime: string;
    cutoffTime: string;
  } | null;
}

/**
 * Returns DailyRequest rows still in REQUESTED state from past days
 * (date < today_in_office), bounded to the last `daysBack` days.
 */
export async function getForgottenOrders(
  officeId: string,
  daysBack = 7,
): Promise<ForgottenOrder[]> {
  const today = getTodayDate();
  const earliest = new Date(today);
  earliest.setUTCDate(earliest.getUTCDate() - daysBack);

  const requests = await prisma.dailyRequest.findMany({
    where: {
      officeId,
      status: "REQUESTED",
      date: { gte: earliest, lt: today },
    },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
      mateSession: {
        select: { id: true, label: true, startTime: true, cutoffTime: true },
      },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  return requests.map((r) => ({
    id: r.id,
    date: r.date,
    user: { ...r.user, image: resolveAvatarUrl(r.user.image) },
    session: r.mateSession,
  }));
}
