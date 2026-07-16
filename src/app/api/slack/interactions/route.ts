import { prisma } from "@/lib/prisma";
import {
  SLACK_CANCEL_ACTION_ID,
  SLACK_MANAGE_ACTION_ID,
  SLACK_MARK_SERVED_ACTION_ID,
  SLACK_PICK_ACTION_ID,
  SLACK_REQUEST_ACTION_ID,
  buildConnectErrorMessage,
  buildConnectSlackMessage,
  buildOrderManageMessage,
  buildSessionCutoffMessage,
  decodeActionValue,
  fetchSlackUserEmail,
  postEphemeralMessage,
  postToResponseUrl,
  updateSlackMessage,
  verifySlackSignature,
} from "@/lib/slack";
import { resolveItemImageUrl } from "@/lib/storage";
import { createSlackLinkToken } from "@/lib/slack-link-token";
import { aliasedEmails } from "@/lib/email-identity";
import { getActiveItems } from "@/lib/items";
import {
  cancelMateRequest,
  createMateRequest,
  getUserSessionRequest,
  listRequestersByItem,
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
  actions: Array<{
    action_id: string;
    value?: string;
    selected_option?: { value: string };
  }>;
  channel?: { id: string };
  message?: { ts: string };
  container?: { is_ephemeral?: boolean };
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * Shows blocks only to the acting user via chat.postEphemeral. A direct HTTP
 * response body is not rendered for block_actions, and response_url ephemerals
 * can clobber the original channel message, so this is the reliable path.
 */
async function ephemeral(
  payload: InteractionPayload,
  blocks: unknown,
  text: string,
): Promise<Response> {
  if (payload.channel?.id) {
    try {
      await postEphemeralMessage({
        channel: payload.channel.id,
        user: payload.user.id,
        blocks: blocks as never,
        text,
      });
    } catch (e) {
      console.error("[slack] postEphemeral failed:", e);
    }
  }
  return new Response(null, { status: 200 });
}

/**
 * Builds the "manage my order" view for a linked user from current DB state.
 */
async function buildManageView(
  userId: string,
  ctx: { officeId: string; mateSessionId: string | null; date: string },
  dateObj: Date,
  locale: string,
) {
  const [items, current] = await Promise.all([
    getActiveItems(ctx.officeId),
    getUserSessionRequest({
      userId,
      officeId: ctx.officeId,
      mateSessionId: ctx.mateSessionId,
      date: dateObj,
    }),
  ]);
  return buildOrderManageMessage({
    officeId: ctx.officeId,
    mateSessionId: ctx.mateSessionId,
    date: ctx.date,
    locale,
    items,
    current: current
      ? {
          itemId: current.itemId,
          itemName: current.itemName,
          imageUrl: resolveItemImageUrl(current.imageKey),
        }
      : null,
  });
}

/**
 * After an action taken from the ephemeral manage view, refresh that view in
 * place; response_url on an ephemeral-sourced interaction targets the
 * ephemeral itself, never the channel message.
 */
async function refreshManageView(
  payload: InteractionPayload,
  userId: string,
  ctx: { officeId: string; mateSessionId: string | null; date: string },
  dateObj: Date,
  locale: string,
): Promise<void> {
  try {
    const { blocks, fallback } = await buildManageView(userId, ctx, dateObj, locale);
    await postToResponseUrl(payload.response_url, {
      response_type: "ephemeral",
      replace_original: true,
      text: fallback,
      blocks,
    });
  } catch (e) {
    console.error("[slack] manage view refresh failed:", e);
  }
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
  "item_not_found",
]);

function mapErrorReason(
  kind: string,
): "closed" | "session_not_found" | "served" | "unknown" | null {
  if (!ERROR_KINDS.has(kind)) return null;
  if (kind === "not_member" || kind === "item_not_found") return "unknown";
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
    return ephemeral(payload, blocks, "Nothing to serve");
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

  const requesterGroups = await listRequestersByItem({
    officeId: ctx.officeId,
    mateSessionId: ctx.mateSessionId,
    date: dateObj,
    status: "SERVED",
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
    requesterGroups,
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
  const isRequest =
    action.action_id === SLACK_REQUEST_ACTION_ID ||
    action.action_id.startsWith(`${SLACK_REQUEST_ACTION_ID}:`);
  const isPick = action.action_id === SLACK_PICK_ACTION_ID;
  const isManage = action.action_id === SLACK_MANAGE_ACTION_ID;
  const isCancel = action.action_id === SLACK_CANCEL_ACTION_ID;
  const isMarkServed = action.action_id === SLACK_MARK_SERVED_ACTION_ID;
  if (!isRequest && !isPick && !isManage && !isCancel && !isMarkServed) {
    return Response.json({});
  }

  // Buttons carry the context in `value`; a select carries it per option.
  const rawValue = action.selected_option?.value ?? action.value;
  if (!rawValue) return badRequest("Missing action value");
  const ctx = decodeActionValue(rawValue);
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
      return ephemeral(payload, blocks, "Unknown error");
    }
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const token = createSlackLinkToken({
      slackUserId: payload.user.id,
      slackUsername: payload.user.name ?? "",
      officeId: ctx.officeId,
      mateSessionId: ctx.mateSessionId,
      itemId: ctx.itemId,
      date: ctx.date,
      responseUrl: payload.response_url,
    });
    const connectUrl = `${appUrl}/slack/link?token=${encodeURIComponent(token)}`;
    const { blocks } = await buildConnectSlackMessage({ connectUrl, locale });
    return ephemeral(payload, blocks, "Connect your Slack to MateCrew");
  }

  // "Manage my order": no write, just show the private view.
  if (isManage) {
    const { blocks, fallback } = await buildManageView(user.id, ctx, dateObj, locale);
    return ephemeral(payload, blocks, fallback);
  }

  const result: RequestResult | CancelResult =
    isRequest || isPick
      ? await createMateRequest({
          userId: user.id,
          officeId: ctx.officeId,
          mateSessionId: ctx.mateSessionId,
          date: dateObj,
          itemId: ctx.itemId,
        })
      : await cancelMateRequest({
          userId: user.id,
          officeId: ctx.officeId,
          mateSessionId: ctx.mateSessionId,
          date: dateObj,
        });

  const fromEphemeral = payload.container?.is_ephemeral === true;

  const errReason = mapErrorReason(result.kind);
  if (errReason) {
    const { blocks } = await buildConnectErrorMessage({
      locale,
      reason: errReason,
    });
    return ephemeral(payload, blocks, "Request not processed");
  }

  await backfillSessionMessageRef(ctx.mateSessionId, payload);

  await refreshSlackSessionMessage({
    officeId: ctx.officeId,
    mateSessionId: ctx.mateSessionId,
    date: dateObj,
  });

  if (fromEphemeral) {
    // The pick/cancel came from the manage view — refresh it in place.
    await refreshManageView(payload, user.id, ctx, dateObj, locale);
  } else if (isRequest) {
    // A channel item button click: confirm privately with the manage view.
    const { blocks, fallback } = await buildManageView(user.id, ctx, dateObj, locale);
    return ephemeral(payload, blocks, fallback);
  }

  return new Response(null, { status: 200 });
}
