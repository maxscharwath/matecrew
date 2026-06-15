import { prisma } from "@/lib/prisma";
import {
  SLACK_CANCEL_ACTION_ID,
  SLACK_MARK_SERVED_ACTION_ID,
  SLACK_REQUEST_ACTION_ID,
  buildConnectErrorMessage,
  buildConnectSlackMessage,
  buildSessionCutoffMessage,
  decodeActionValue,
  fetchSlackUserEmail,
  updateSlackMessage,
  verifySlackSignature,
} from "@/lib/slack";
import { createSlackLinkToken } from "@/lib/slack-link-token";
import { aliasedEmails } from "@/lib/email-identity";
import {
  cancelMateRequest,
  createMateRequest,
  type CancelResult,
  type RequestResult,
} from "@/lib/mate-request";
import { refreshSlackSessionMessage } from "@/lib/notifications";
import { serveSession } from "@/lib/serve-session";
import { getCurrentTimeInTimezone } from "@/lib/date";
import { revalidatePath } from "next/cache";

interface InteractionPayload {
  type: string;
  response_url: string;
  user: { id: string; name?: string };
  actions: Array<{ action_id: string; value: string }>;
  channel?: { id: string };
  message?: { ts: string };
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function ephemeral(blocks: unknown, text: string) {
  return Response.json({ response_type: "ephemeral", text, blocks });
}

async function resolveUser(
  slackUserId: string,
): Promise<{ id: string } | null> {
  const byId = await prisma.user.findUnique({
    where: { slackUserId },
    select: { id: true },
  });
  if (byId) return byId;

  const email = await fetchSlackUserEmail(slackUserId);
  if (!email) return null;

  // Slack and the app account may use different alias domains for the same
  // person (e.g. `owt.swiss` vs `openwt.com`), so match across the alias group.
  const candidates = aliasedEmails(email);
  if (candidates.length === 0) return null;

  const byEmail = await prisma.user.findFirst({
    where: { email: { in: candidates } },
    select: { id: true, slackUserId: true },
  });
  if (!byEmail) return null;

  if (!byEmail.slackUserId) {
    await prisma.user.update({
      where: { id: byEmail.id },
      data: { slackUserId },
    });
  }
  return { id: byEmail.id };
}

const ERROR_KINDS = new Set([
  "closed",
  "session_not_found",
  "served",
  "not_member",
]);

function mapErrorReason(
  kind: string,
): "closed" | "session_not_found" | "served" | "unknown" | null {
  if (!ERROR_KINDS.has(kind)) return null;
  if (kind === "not_member") return "unknown";
  return kind as "closed" | "session_not_found" | "served";
}

async function backfillSessionMessageRef(
  mateSessionId: string | null,
  payload: InteractionPayload,
) {
  if (!mateSessionId || !payload.message?.ts || !payload.channel?.id) return;
  await prisma.mateSession.updateMany({
    where: {
      id: mateSessionId,
      OR: [
        { lastNotifiedMessageTs: null },
        { lastNotifiedChannelId: null },
      ],
    },
    data: {
      lastNotifiedMessageTs: payload.message.ts,
      lastNotifiedChannelId: payload.channel.id,
    },
  });
}

async function handleMarkServed(
  ctx: { officeId: string; mateSessionId: string | null; date: string },
  dateObj: Date,
  payload: InteractionPayload,
): Promise<Response> {
  const office = await prisma.office.findUnique({
    where: { id: ctx.officeId },
    select: { name: true, locale: true, timezone: true },
  });
  const locale = office?.locale ?? "fr";

  const user = await resolveUser(payload.user.id);

  const result = await serveSession({
    officeId: ctx.officeId,
    mateSessionId: ctx.mateSessionId,
    date: dateObj,
    actingUserId: user?.id ?? null,
    movementNote: `Slack mark-served by ${payload.user.name ?? payload.user.id}`,
  });

  if (result.kind === "empty") {
    const { blocks } = await buildConnectErrorMessage({
      locale,
      reason: "served",
    });
    return ephemeral(blocks, "Nothing to serve");
  }

  revalidatePath(`/org/${ctx.officeId}/runner`);
  revalidatePath(`/org/${ctx.officeId}/request`);

  if (!office || !payload.channel?.id || !payload.message?.ts) {
    return new Response(null, { status: 200 });
  }

  const sessionRow = ctx.mateSessionId
    ? await prisma.mateSession.findUnique({
        where: { id: ctx.mateSessionId },
        select: { label: true },
      })
    : null;

  const servedRequests = await prisma.dailyRequest.findMany({
    where: {
      officeId: ctx.officeId,
      mateSessionId: ctx.mateSessionId,
      date: dateObj,
      status: "SERVED",
    },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const userName = user
    ? (await prisma.user.findUnique({
        where: { id: user.id },
        select: { name: true },
      }))?.name ?? payload.user.name ?? "?"
    : payload.user.name ?? "?";

  const { blocks, fallback } = await buildSessionCutoffMessage({
    officeId: ctx.officeId,
    officeName: office.name,
    mateSessionId: ctx.mateSessionId,
    sessionLabel: sessionRow?.label ?? null,
    date: ctx.date,
    locale,
    count: servedRequests.length,
    requesters: servedRequests.map((r) => r.user.name),
    servedBy: {
      name: userName,
      time: getCurrentTimeInTimezone(office.timezone),
    },
  });

  try {
    await updateSlackMessage({
      channel: payload.channel.id,
      ts: payload.message.ts,
      blocks,
      text: fallback,
    });
  } catch {
    // best-effort: serving already committed, message refresh isn't critical
  }

  return new Response(null, { status: 200 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const isValid = verifySlackSignature(
    rawBody,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"),
  );
  if (!isValid) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  const raw = form.get("payload");
  if (!raw) return badRequest("Missing payload");

  let payload: InteractionPayload;
  try {
    payload = JSON.parse(raw) as InteractionPayload;
  } catch {
    return badRequest("Invalid payload JSON");
  }

  if (payload.type !== "block_actions") {
    return Response.json({});
  }

  const action = payload.actions?.[0];
  if (!action) return Response.json({});
  const isRequest = action.action_id === SLACK_REQUEST_ACTION_ID;
  const isCancel = action.action_id === SLACK_CANCEL_ACTION_ID;
  const isMarkServed = action.action_id === SLACK_MARK_SERVED_ACTION_ID;
  if (!isRequest && !isCancel && !isMarkServed) return Response.json({});

  const ctx = decodeActionValue(action.value);
  if (!ctx) return badRequest("Invalid action value");

  const dateObj = new Date(`${ctx.date}T00:00:00.000Z`);
  if (Number.isNaN(dateObj.getTime())) return badRequest("Invalid date");

  if (isMarkServed) {
    return handleMarkServed(ctx, dateObj, payload);
  }

  const office = await prisma.office.findUnique({
    where: { id: ctx.officeId },
    select: { locale: true },
  });
  const locale = office?.locale ?? "fr";

  const user = await resolveUser(payload.user.id);

  if (!user) {
    if (isCancel) {
      const { blocks } = await buildConnectErrorMessage({
        locale,
        reason: "unknown",
      });
      return ephemeral(blocks, "Unknown error");
    }
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const token = createSlackLinkToken({
      slackUserId: payload.user.id,
      slackUsername: payload.user.name ?? "",
      officeId: ctx.officeId,
      mateSessionId: ctx.mateSessionId,
      date: ctx.date,
      responseUrl: payload.response_url,
    });
    const connectUrl = `${appUrl}/slack/link?token=${encodeURIComponent(token)}`;
    const { blocks } = await buildConnectSlackMessage({ connectUrl, locale });
    return ephemeral(blocks, "Connect your Slack to MateCrew");
  }

  const result: RequestResult | CancelResult = isRequest
    ? await createMateRequest({
        userId: user.id,
        officeId: ctx.officeId,
        mateSessionId: ctx.mateSessionId,
        date: dateObj,
      })
    : await cancelMateRequest({
        userId: user.id,
        officeId: ctx.officeId,
        mateSessionId: ctx.mateSessionId,
        date: dateObj,
      });

  const errReason = mapErrorReason(result.kind);
  if (errReason) {
    const { blocks } = await buildConnectErrorMessage({
      locale,
      reason: errReason,
    });
    return ephemeral(blocks, "Request not processed");
  }

  await backfillSessionMessageRef(ctx.mateSessionId, payload);

  await refreshSlackSessionMessage({
    officeId: ctx.officeId,
    mateSessionId: ctx.mateSessionId,
    date: dateObj,
  });

  return new Response(null, { status: 200 });
}
