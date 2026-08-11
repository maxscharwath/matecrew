import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { getDayOfWeek, getTodayDate, toISODateString } from "@/lib/date";
import { getSessionsForDay } from "@/lib/session-utils";
import { serveSession } from "@/lib/serve-session";
import { refreshSlackSessionMessage } from "@/lib/notifications";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { stockDeltaOps } from "@/lib/stock";
import { McpToolError, resolveOffice } from "@/lib/mcp/context";
import { notifyQuietly } from "@/lib/mcp/notify";
import { defineTool } from "@/lib/mcp/tool";
import { isoDateArg, officeArg, parseIsoDate } from "@/lib/mcp/schemas";

/**
 * "Runner" tools — the prep-and-deliver side of a session, open to any member
 * (whoever fetches the round), matching the web runner screen. Serving deducts
 * stock and creates the consumption entries that later drive reimbursements.
 */

/** Loads a request and asserts it belongs to the resolved office. */
async function requireRequest(officeId: string, requestId: string) {
  const request = await prisma.dailyRequest.findUnique({
    where: { id: requestId },
    include: {
      item: { select: { id: true, name: true } },
      user: { select: { name: true } },
    },
  });
  if (!request || request.officeId !== officeId) {
    throw new McpToolError(
      `No maté order with id ${requestId} in this office. Call matecrew_list_pending_orders for the current ids.`,
    );
  }
  return request;
}

export function registerRunnerTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_list_pending_orders",
      title: "List orders to prepare",
      description:
        "The prep list for a session: every order and whether it is still pending or already served, grouped by item. Use this to know what to fetch and to get the request ids the serve tools need.",
      inputSchema: {
        office: officeArg,
        date: isoDateArg.optional().describe("Defaults to today."),
        sessionId: z
          .string()
          .optional()
          .describe("Restrict to one session. Omit for every session that day."),
      },
      readOnly: true,
      idempotent: true,
    },
    async ({ office, date, sessionId }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const day = date ? parseIsoDate(date) : getTodayDate();

      const requests = await prisma.dailyRequest.findMany({
        where: {
          officeId: scope.officeId,
          date: day,
          ...(sessionId ? { mateSessionId: sessionId } : {}),
        },
        include: {
          item: { select: { name: true } },
          user: { select: { name: true } },
          mateSession: { select: { id: true, label: true, cutoffTime: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      const byItem = new Map<string, number>();
      for (const r of requests) {
        if (r.status !== "REQUESTED") continue;
        byItem.set(r.item.name, (byItem.get(r.item.name) ?? 0) + 1);
      }

      return {
        office: scope.officeName,
        date: toISODateString(day),
        pendingCount: requests.filter((r) => r.status === "REQUESTED").length,
        servedCount: requests.filter((r) => r.status === "SERVED").length,
        /** What to physically fetch, item by item. */
        toFetch: [...byItem.entries()].map(([item, count]) => ({ item, count })),
        orders: requests.map((r) => ({
          requestId: r.id,
          person: r.user.name,
          item: r.item.name,
          status: r.status,
          sessionId: r.mateSession?.id ?? null,
          sessionLabel: r.mateSession?.label ?? null,
        })),
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_serve_session",
      title: "Serve every pending order",
      description:
        "Mark all pending orders in a session as served in one go: records each person's consumption and deducts the cans from stock. This is how a completed maté round is normally closed out.",
      inputSchema: {
        office: officeArg,
        sessionId: z
          .string()
          .optional()
          .describe(
            "Session to serve. Omit to serve the most recent session that has started today.",
          ),
        date: isoDateArg.optional().describe("Defaults to today."),
      },
      idempotent: true,
    },
    async ({ office, sessionId, date }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const day = date ? parseIsoDate(date) : getTodayDate();

      let mateSessionId: string | null = sessionId ?? null;
      if (!sessionId) {
        // Only safe to infer the session when every pending order sits in one.
        const pending = await prisma.dailyRequest.findMany({
          where: { officeId: scope.officeId, date: day, status: "REQUESTED" },
          select: { mateSessionId: true },
          distinct: ["mateSessionId"],
        });
        if (pending.length === 0) {
          return {
            ok: true,
            servedCount: 0,
            message: "There are no pending orders to serve.",
          };
        }
        if (pending.length > 1) {
          const sessions = await getSessionsForDay(
            scope.officeId,
            getDayOfWeek(scope.timezone),
          );
          throw new McpToolError(
            `Pending orders span several sessions — pass sessionId. Sessions today: ${sessions
              .map((s) => `${s.label ?? "session"} ${s.startTime} (${s.id})`)
              .join("; ")}.`,
          );
        }
        mateSessionId = pending[0].mateSessionId;
      }

      const result = await serveSession({
        officeId: scope.officeId,
        mateSessionId,
        date: day,
        actingUserId: actor.userId,
        movementNote: "Served via MCP",
      });

      if (result.kind === "empty") {
        return {
          ok: true,
          servedCount: 0,
          message: "That session had no pending orders — nothing to serve.",
        };
      }

      await notifyQuietly("session-message", () =>
        refreshSlackSessionMessage({
          officeId: scope.officeId,
          mateSessionId,
          date: day,
        }),
      );

      return {
        ok: true,
        servedCount: result.servedCount,
        message: `Served ${result.servedCount} maté${
          result.servedCount === 1 ? "" : "s"
        } in ${scope.officeName} and deducted them from stock.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_serve_order",
      title: "Serve one order",
      description:
        "Mark a single order as served: records that person's consumption and deducts one can from stock. Use matecrew_serve_session to close out a whole round at once.",
      inputSchema: {
        office: officeArg,
        requestId: z
          .string()
          .describe("Request id from matecrew_list_pending_orders."),
      },
      idempotent: true,
    },
    async ({ office, requestId }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const request = await requireRequest(scope.officeId, requestId);

      if (request.status === "SERVED") {
        return {
          ok: true,
          status: "already_served",
          message: `${request.user.name}'s ${request.item.name} was already served.`,
        };
      }

      await prisma.$transaction([
        prisma.dailyRequest.update({
          where: { id: requestId },
          data: { status: "SERVED" },
        }),
        prisma.consumptionEntry.create({
          data: {
            officeId: scope.officeId,
            userId: request.userId,
            itemId: request.itemId,
            date: request.date,
            qty: 1,
            source: "DAILY_REQUEST",
          },
        }),
        ...stockDeltaOps({
          officeId: scope.officeId,
          itemId: request.itemId,
          delta: -1,
          reason: "SERVED",
          userId: actor.userId,
        }),
      ]);

      await notifyQuietly("low-stock", () =>
        checkAndAlertLowStock(scope.officeId, request.itemId),
      );

      return {
        ok: true,
        person: request.user.name,
        item: request.item.name,
        message: `Served ${request.user.name}'s ${request.item.name}.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_unserve_order",
      title: "Undo a served order",
      description:
        "Reverse a serve that was recorded by mistake: puts the order back to pending, removes the consumption entry and returns the can to stock.",
      inputSchema: {
        office: officeArg,
        requestId: z.string().describe("Request id of the served order."),
      },
      destructive: true,
      idempotent: true,
    },
    async ({ office, requestId }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const request = await requireRequest(scope.officeId, requestId);

      if (request.status !== "SERVED") {
        throw new McpToolError(
          `That order is ${request.status}, not SERVED, so there is nothing to undo.`,
        );
      }

      await prisma.$transaction([
        prisma.dailyRequest.update({
          where: { id: requestId },
          data: { status: "REQUESTED" },
        }),
        prisma.consumptionEntry.deleteMany({
          where: {
            officeId: scope.officeId,
            userId: request.userId,
            itemId: request.itemId,
            date: request.date,
            source: "DAILY_REQUEST",
          },
        }),
        ...stockDeltaOps({
          officeId: scope.officeId,
          itemId: request.itemId,
          delta: 1,
          reason: "UNSERVED",
          userId: actor.userId,
        }),
      ]);

      return {
        ok: true,
        message: `Reverted ${request.user.name}'s ${request.item.name} to pending and returned the can to stock.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_drop_order",
      title: "Drop someone's order",
      description:
        "Remove a pending order from the prep list — for someone who left or changed their mind after the cutoff. Unlike matecrew_cancel_order this works after a session has closed, but it cannot touch an order that was already served.",
      inputSchema: {
        office: officeArg,
        requestId: z.string().describe("Request id of the pending order."),
      },
      destructive: true,
      idempotent: true,
    },
    async ({ office, requestId }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const request = await requireRequest(scope.officeId, requestId);

      if (request.status === "SERVED") {
        throw new McpToolError(
          "That maté was already served. Use matecrew_unserve_order first if the serve was a mistake.",
        );
      }

      await prisma.dailyRequest.delete({ where: { id: requestId } });

      await notifyQuietly("session-message", () =>
        refreshSlackSessionMessage({
          officeId: scope.officeId,
          mateSessionId: request.mateSessionId,
          date: request.date,
        }),
      );

      return {
        ok: true,
        message: `Dropped ${request.user.name}'s ${request.item.name} from the prep list.`,
      };
    },
  );
}
