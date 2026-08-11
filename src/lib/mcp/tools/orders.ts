import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { getCurrentTimeInTimezone, getDayOfWeek, getTodayDate, toISODateString } from "@/lib/date";
import { getActiveItems, resolveItemId } from "@/lib/items";
import {
  cancelMateRequest,
  createMateRequest,
  listRequestersByItem,
} from "@/lib/mate-request";
import { getSessionsForDay, isSessionOpen } from "@/lib/session-utils";
import { refreshSlackSessionMessage } from "@/lib/notifications";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { stockDeltaOps } from "@/lib/stock";
import { McpToolError, resolveOffice, type OfficeScope } from "@/lib/mcp/context";
import { notifyQuietly } from "@/lib/mcp/notify";
import { defineTool } from "@/lib/mcp/tool";
import { DAY_NAMES, isoDateArg, officeArg, parseIsoDate } from "@/lib/mcp/schemas";

/** Resolves the item the user asked for by id or (case-insensitive) name. */
async function resolveItemByNameOrId(
  officeId: string,
  item: string | undefined,
): Promise<string | null> {
  if (!item) return null;
  const wanted = item.trim();
  const match = await prisma.item.findFirst({
    where: {
      officeId,
      OR: [{ id: wanted }, { name: { equals: wanted, mode: "insensitive" } }],
    },
    select: { id: true, active: true, name: true },
  });
  if (!match) {
    const available = await prisma.item.findMany({
      where: { officeId, active: true },
      select: { name: true },
    });
    throw new McpToolError(
      `No item called "${item}" in this office. Available: ${
        available.map((i) => i.name).join(", ") || "none"
      }.`,
    );
  }
  if (!match.active) {
    throw new McpToolError(
      `"${match.name}" is no longer offered in this office.`,
    );
  }
  return match.id;
}

/**
 * Picks the session an order applies to. Sessions are the windows when maté is
 * ordered and delivered; `sessionId` targets one explicitly, otherwise the one
 * that is currently open is used. An office may run no sessions at all, in
 * which case orders are session-less (`null`) — the same convention the web UI
 * and Slack handlers use.
 */
async function resolveSessionForOrder(
  scope: OfficeScope,
  sessionId: string | undefined,
): Promise<string | null> {
  const sessions = await getSessionsForDay(
    scope.officeId,
    getDayOfWeek(scope.timezone),
  );

  if (sessionId) {
    const explicit = sessions.find((s) => s.id === sessionId);
    if (!explicit) {
      throw new McpToolError(
        `Session ${sessionId} is not one of today's sessions in ${scope.officeName}. Call matecrew_get_today to list them.`,
      );
    }
    return explicit.id;
  }

  if (sessions.length === 0) return null;

  const open = sessions.filter((s) => isSessionOpen(s, scope.timezone));
  if (open.length === 1) return open[0].id;
  if (open.length > 1) {
    throw new McpToolError(
      `Several sessions are open right now — pass sessionId. Open: ${open
        .map((s) => `${s.label ?? "session"} ${s.startTime}-${s.cutoffTime} (${s.id})`)
        .join("; ")}.`,
    );
  }

  const now = getCurrentTimeInTimezone(scope.timezone);
  const next = sessions.find((s) => s.startTime > now);
  throw new McpToolError(
    next
      ? `No session is open in ${scope.officeName} right now (local time ${now}). The next one, ${
          next.label ?? "session"
        }, opens at ${next.startTime} and closes at ${next.cutoffTime}.`
      : `Ordering is closed in ${scope.officeName} for today (local time ${now}). Today's sessions: ${sessions
          .map((s) => `${s.startTime}-${s.cutoffTime}`)
          .join(", ")}.`,
  );
}

export function registerOrderTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_get_today",
      title: "Today's maté sessions",
      description:
        "The state of play right now: today's sessions with their open/closed status and cutoff times, what the caller has ordered, who else ordered what, available items and stock on hand. Call this before ordering so you know whether a session is open.",
      inputSchema: {
        office: officeArg,
        date: isoDateArg
          .optional()
          .describe("Defaults to today. Use for looking at another day."),
      },
      readOnly: true,
      idempotent: true,
    },
    async ({ office, date }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const day = date ? parseIsoDate(date) : getTodayDate();
      const localTime = getCurrentTimeInTimezone(scope.timezone);
      const isToday = toISODateString(day) === toISODateString(getTodayDate());

      // For today, "which day is it" is the office's day, not the server's —
      // near midnight those differ. For any other date the date itself decides.
      const sessions = await getSessionsForDay(
        scope.officeId,
        isToday ? getDayOfWeek(scope.timezone) : day.getUTCDay(),
      );

      const [items, myRequests] = await Promise.all([
        getActiveItems(scope.officeId),
        prisma.dailyRequest.findMany({
          where: {
            officeId: scope.officeId,
            userId: actor.userId,
            date: day,
          },
          select: {
            id: true,
            status: true,
            mateSessionId: true,
            item: { select: { id: true, name: true } },
          },
        }),
      ]);

      const sessionViews = await Promise.all(
        sessions.map(async (session) => {
          const groups = await listRequestersByItem({
            officeId: scope.officeId,
            mateSessionId: session.id,
            date: day,
          });
          const mine = myRequests.find((r) => r.mateSessionId === session.id);
          return {
            sessionId: session.id,
            label: session.label,
            startTime: session.startTime,
            cutoffTime: session.cutoffTime,
            // Only meaningful for today; a past or future date is never "open".
            open: isToday && isSessionOpen(session, scope.timezone),
            yourOrder: mine
              ? { item: mine.item.name, status: mine.status, requestId: mine.id }
              : null,
            orders: groups.map((g) => ({
              item: g.itemName,
              count: g.names.length,
              people: g.names,
            })),
            totalOrders: groups.reduce((sum, g) => sum + g.names.length, 0),
          };
        }),
      );

      // Offices with no schedule still take session-less orders.
      const looseOrders = myRequests.filter((r) => r.mateSessionId === null);

      return {
        office: scope.officeName,
        date: toISODateString(day),
        dayOfWeek: DAY_NAMES[day.getUTCDay()],
        officeLocalTime: isToday ? localTime : undefined,
        sessions: sessionViews,
        sessionlessOrders: looseOrders.map((r) => ({
          requestId: r.id,
          item: r.item.name,
          status: r.status,
        })),
        items: items.map((i) => ({
          id: i.id,
          name: i.name,
          isDefault: i.isDefault,
          stockQty: i.stockQty,
        })),
        note:
          sessions.length === 0
            ? "This office has no sessions scheduled for this day. Orders can still be placed without a session, and an admin can add sessions with matecrew_admin_add_session."
            : undefined,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_order_mate",
      title: "Order a maté",
      description:
        "Register the caller for a maté in an open session. Calling it again with a different item switches the order while the session is still open. Idempotent — ordering twice does not queue two matés.",
      inputSchema: {
        office: officeArg,
        item: z
          .string()
          .optional()
          .describe(
            "Item id or name (e.g. 'Maté Zero'). Omit for the office default item.",
          ),
        sessionId: z
          .string()
          .optional()
          .describe(
            "Target session id. Omit to use the session that is open now.",
          ),
      },
      idempotent: true,
    },
    async ({ office, item, sessionId }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const mateSessionId = await resolveSessionForOrder(scope, sessionId);
      const itemId = await resolveItemByNameOrId(scope.officeId, item);
      const date = getTodayDate();

      const result = await createMateRequest({
        userId: actor.userId,
        officeId: scope.officeId,
        mateSessionId,
        date,
        itemId,
      });

      switch (result.kind) {
        case "created":
        case "already_registered": {
          // Keep the live Slack message in step with the new order count.
          await refreshSlackSessionMessage({
            officeId: scope.officeId,
            mateSessionId,
            date,
          });
          const current = await prisma.dailyRequest.findFirst({
            where: {
              officeId: scope.officeId,
              userId: actor.userId,
              date,
              mateSessionId,
            },
            select: { id: true, status: true, item: { select: { name: true } } },
          });
          return {
            ok: true,
            status: result.kind,
            office: scope.officeName,
            date: toISODateString(date),
            sessionId: mateSessionId,
            item: current?.item.name,
            requestId: current?.id,
            message:
              result.kind === "created"
                ? `Ordered ${current?.item.name} for ${scope.officeName}.`
                : `Already registered with ${current?.item.name} — nothing changed.`,
          };
        }
        case "closed":
          throw new McpToolError(
            `Orders for that session closed at ${result.cutoffTime}.`,
          );
        case "item_not_found":
          throw new McpToolError(
            "This office has no default item configured, so an item must be named. An admin can set one with matecrew_admin_update_item.",
          );
        case "session_not_found":
          throw new McpToolError(
            "That session does not belong to this office. Call matecrew_get_today for the current sessions.",
          );
        case "not_member":
          throw new McpToolError(
            `You are not a member of ${scope.officeName}.`,
          );
      }
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_cancel_order",
      title: "Cancel my maté order",
      description:
        "Withdraw the caller's maté order for a session, while the session is still open. An order that has already been served cannot be cancelled here — use matecrew_cancel_consumption instead.",
      inputSchema: {
        office: officeArg,
        sessionId: z
          .string()
          .optional()
          .describe(
            "Target session id. Omit to use the session that is open now.",
          ),
      },
      destructive: true,
      idempotent: true,
    },
    async ({ office, sessionId }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const mateSessionId = await resolveSessionForOrder(scope, sessionId);
      const date = getTodayDate();

      const result = await cancelMateRequest({
        userId: actor.userId,
        officeId: scope.officeId,
        mateSessionId,
        date,
      });

      switch (result.kind) {
        case "cancelled":
          await refreshSlackSessionMessage({
            officeId: scope.officeId,
            mateSessionId,
            date,
          });
          return {
            ok: true,
            message: `Cancelled your maté order in ${scope.officeName}.`,
          };
        case "not_registered":
          return {
            ok: true,
            status: "not_registered",
            message: "You had no order for that session — nothing to cancel.",
          };
        case "served":
          throw new McpToolError(
            "That maté was already served, so the order cannot be cancelled. Use matecrew_cancel_consumption to reverse the consumption instead.",
          );
        case "closed":
          throw new McpToolError(
            `That session closed at ${result.cutoffTime}, so the order can no longer be cancelled.`,
          );
        case "session_not_found":
          throw new McpToolError(
            "That session does not belong to this office.",
          );
        case "not_member":
          throw new McpToolError(
            `You are not a member of ${scope.officeName}.`,
          );
      }
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_take_a_can",
      title: "Take a can now",
      description:
        "Record that the caller took a can straight from the fridge outside any session. This immediately decrements stock and counts towards their share of the next reimbursement. Not idempotent — each call records one more can.",
      inputSchema: {
        office: officeArg,
        item: z
          .string()
          .optional()
          .describe("Item id or name. Omit for the office default item."),
      },
    },
    async ({ office, item }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const requested = await resolveItemByNameOrId(scope.officeId, item);
      const itemId = await resolveItemId(scope.officeId, requested);
      if (!itemId) {
        throw new McpToolError(
          "This office has no default item configured, so an item must be named.",
        );
      }

      const stock = await prisma.stock.findUnique({
        where: { officeId_itemId: { officeId: scope.officeId, itemId } },
        select: { currentQty: true, item: { select: { name: true } } },
      });
      if (!stock) {
        throw new McpToolError(
          "That item has no stock pool in this office yet.",
        );
      }
      if (stock.currentQty <= 0) {
        throw new McpToolError(
          `${stock.item.name} is out of stock (0 left), so the can cannot be recorded. An admin may need to record a delivery.`,
        );
      }

      const today = getTodayDate();
      await prisma.$transaction([
        prisma.consumptionEntry.create({
          data: {
            officeId: scope.officeId,
            userId: actor.userId,
            itemId,
            date: today,
            qty: 1,
            source: "MANUAL",
          },
        }),
        ...stockDeltaOps({
          officeId: scope.officeId,
          itemId,
          delta: -1,
          reason: "SERVED",
          note: "Self-serve",
          userId: actor.userId,
        }),
      ]);

      await notifyQuietly("low-stock", () =>
        checkAndAlertLowStock(scope.officeId, itemId),
      );

      return {
        ok: true,
        item: stock.item.name,
        date: toISODateString(today),
        remainingStock: stock.currentQty - 1,
        message: `Recorded one ${stock.item.name} for you. ${
          stock.currentQty - 1
        } left in ${scope.officeName}.`,
      };
    },
  );
}
