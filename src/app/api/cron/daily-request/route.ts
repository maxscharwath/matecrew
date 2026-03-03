import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendSlackMessage, buildDailyRequestMessage } from "@/lib/slack";
import { toISODateString, getTodayDate } from "@/lib/date";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const offices = await prisma.office.findMany({
    where: { slackWebhookUrl: { not: null } },
    select: { id: true, name: true, slackWebhookUrl: true },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const today = toISODateString(getTodayDate());

  const results: { office: string; ok: boolean; error?: string }[] = [];

  for (const office of offices) {
    try {
      const blocks = buildDailyRequestMessage(
        office.id,
        office.name,
        today,
        appUrl
      );
      await sendSlackMessage(office.slackWebhookUrl!, blocks);
      results.push({ office: office.name, ok: true });
    } catch (e) {
      results.push({
        office: office.name,
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ sent: results.length, results });
}
