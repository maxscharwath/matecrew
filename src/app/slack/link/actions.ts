"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-utils";
import { verifySlackLinkToken } from "@/lib/slack-link-token";
import {
  buildSessionRequestMessage,
  postToResponseUrl,
} from "@/lib/slack";
import { createMateRequest, listRequesterNames } from "@/lib/mate-request";

export async function confirmSlackLink(token: string): Promise<void> {
  const session = await requireSession();
  const payload = verifySlackLinkToken(token);
  if (!payload) {
    redirect(`/slack/link?token=${encodeURIComponent(token)}`);
  }

  const existingOwner = await prisma.user.findUnique({
    where: { slackUserId: payload.slackUserId },
    select: { id: true },
  });
  if (existingOwner && existingOwner.id !== session.user.id) {
    redirect(`/slack/link?token=${encodeURIComponent(token)}`);
  }

  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { slackUserId: true },
  });
  if (
    current?.slackUserId &&
    current.slackUserId !== payload.slackUserId
  ) {
    redirect(`/slack/link?token=${encodeURIComponent(token)}`);
  }

  if (!current?.slackUserId) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { slackUserId: payload.slackUserId },
    });
  }

  const dateObj = new Date(`${payload.date}T00:00:00.000Z`);
  if (!Number.isNaN(dateObj.getTime())) {
    await createMateRequest({
      userId: session.user.id,
      officeId: payload.officeId,
      mateSessionId: payload.mateSessionId,
      date: dateObj,
    });

    const [office, mateSession, requesters] = await Promise.all([
      prisma.office.findUnique({
        where: { id: payload.officeId },
        select: { name: true, locale: true },
      }),
      payload.mateSessionId
        ? prisma.mateSession.findUnique({
            where: { id: payload.mateSessionId },
            select: { label: true, cutoffTime: true },
          })
        : Promise.resolve(null),
      listRequesterNames({
        officeId: payload.officeId,
        mateSessionId: payload.mateSessionId,
        date: dateObj,
      }),
    ]);

    if (office) {
      const { blocks, fallback } = await buildSessionRequestMessage({
        officeId: payload.officeId,
        officeName: office.name,
        mateSessionId: payload.mateSessionId,
        sessionLabel: mateSession?.label ?? null,
        cutoffTime: mateSession?.cutoffTime ?? "",
        date: payload.date,
        locale: office.locale,
        requesters,
      });
      try {
        await postToResponseUrl(payload.responseUrl, {
          replace_original: true,
          response_type: "in_channel",
          text: fallback,
          blocks,
        });
      } catch {
        // response_url may have expired; the link + request still succeeded
      }
    }
  }

  redirect(`/org/${payload.officeId}/request?slackLinked=1`);
}
