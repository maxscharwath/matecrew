import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  CAFFEINE_MAX_MG_PER_DAY,
  CAFFEINE_MODERATE_MG_PER_DAY,
  getOfficeStats,
  STATS_PERIODS,
  SUGAR_IDEAL_G_PER_DAY,
  SUGAR_MAX_G_PER_DAY,
  type StatsPeriod,
} from "@/lib/stats";
import { resolveOffice } from "@/lib/mcp/context";
import { defineTool } from "@/lib/mcp/tool";
import { officeArg } from "@/lib/mcp/schemas";

export function registerStatsTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_stats",
      title: "Office maté statistics",
      description:
        "Consumption analytics for an office over a period: the leaderboard, per-item breakdown, a timeline, and the caller's own nutrition figures (litres, sugar, caffeine) against health reference values. Everyone in the office can see everyone's totals, exactly as on the stats screen.",
      inputSchema: {
        office: officeArg,
        period: z
          .enum(STATS_PERIODS)
          .optional()
          .describe(
            "Window to aggregate: 'wtd' week to date, '30d', '90d', '12m', 'ytd', 'all'. Defaults to 30d.",
          ),
        includeLeaderboard: z
          .boolean()
          .optional()
          .describe(
            "Include the per-person leaderboard. Defaults to true; set false for a compact summary.",
          ),
      },
      readOnly: true,
      idempotent: true,
    },
    async ({ office, period, includeLeaderboard }, { actor }) => {
      const scope = await resolveOffice(actor, office);
      const stats = await getOfficeStats(
        scope.officeId,
        actor.userId,
        (period as StatsPeriod | undefined) ?? undefined,
      );

      const itemNames = new Map(stats.byItem.map((i) => [i.itemId, i.name]));
      const namedQtyByItem = (qtyByItem: Record<string, number>) =>
        Object.fromEntries(
          Object.entries(qtyByItem).map(([itemId, qty]) => [
            itemNames.get(itemId) ?? itemId,
            qty,
          ]),
        );

      return {
        office: scope.officeName,
        period: stats.period,
        range: stats.range,
        totals: stats.totals,
        byItem: stats.byItem.map((i) => ({ item: i.name, qty: i.qty })),
        you: {
          qty: stats.me.qty,
          liters: stats.me.liters,
          sugarGrams: stats.me.sugarGrams,
          caffeineMg: stats.me.caffeineMg,
          avgSugarPerDay: stats.me.avgSugarPerDay,
          avgCaffeinePerDay: stats.me.avgCaffeinePerDay,
          sugarRisk: stats.me.sugarRisk,
          caffeineRisk: stats.me.caffeineRisk,
          favouriteItems: namedQtyByItem(stats.me.qtyByItem),
          rank:
            stats.users.findIndex((u) => u.userId === actor.userId) + 1 ||
            null,
        },
        // Reference values behind the risk ratings, so the figures above can be
        // explained without inventing thresholds.
        healthReference: {
          sugarIdealGramsPerDay: SUGAR_IDEAL_G_PER_DAY,
          sugarMaxGramsPerDay: SUGAR_MAX_G_PER_DAY,
          caffeineModerateMgPerDay: CAFFEINE_MODERATE_MG_PER_DAY,
          caffeineMaxMgPerDay: CAFFEINE_MAX_MG_PER_DAY,
        },
        leaderboard:
          includeLeaderboard === false
            ? undefined
            : stats.users.map((u, index) => ({
                rank: index + 1,
                name: u.name,
                qty: u.qty,
                liters: u.liters,
                avgSugarPerDay: u.avgSugarPerDay,
                avgCaffeinePerDay: u.avgCaffeinePerDay,
                sugarRisk: u.sugarRisk,
                caffeineRisk: u.caffeineRisk,
              })),
        timeline: stats.timeline,
        granularity: stats.granularity,
      };
    },
  );
}
