import type { McpServer } from "@modelcontextprotocol/server";
import { registerAccountTools } from "@/lib/mcp/tools/account";
import { registerAdminConsumptionTools } from "@/lib/mcp/tools/admin-consumption";
import { registerAdminItemTools } from "@/lib/mcp/tools/admin-items";
import { registerAdminMemberTools } from "@/lib/mcp/tools/admin-members";
import { registerAdminOfficeTools } from "@/lib/mcp/tools/admin-office";
import { registerAdminPurchaseTools } from "@/lib/mcp/tools/admin-purchases";
import { registerAdminReimbursementTools } from "@/lib/mcp/tools/admin-reimbursements";
import { registerAdminScheduleTools } from "@/lib/mcp/tools/admin-schedule";
import { registerAdminStockTools } from "@/lib/mcp/tools/admin-stock";
import { registerCatalogTools } from "@/lib/mcp/tools/catalog";
import { registerConsumptionTools } from "@/lib/mcp/tools/consumption";
import { registerOrderTools } from "@/lib/mcp/tools/orders";
import { registerReimbursementTools } from "@/lib/mcp/tools/reimbursements";
import { registerRunnerTools } from "@/lib/mcp/tools/runner";
import { registerStatsTools } from "@/lib/mcp/tools/stats";

/**
 * Guidance handed to the model on connect, alongside the tool list. It covers
 * what the tools cannot say for themselves: the shape of the domain, and the
 * couple of habits that keep an agent from guessing.
 */
export const MCP_INSTRUCTIONS = `MateCrew tracks shared maté (a canned yerba-maté soft drink) in office fridges: who ordered one, what is in stock, who paid for the last bulk order, and who owes whom at the end of the month.

How the domain fits together:
- An **office** is one fridge and one group of people. A user can belong to several; every tool takes an optional \`office\` (id or name) and falls back to their default.
- **Sessions** are recurring windows (e.g. Tuesday 09:30-10:00) when people order. At the start time MateCrew posts to Slack; at the cutoff, ordering closes. Orders can only be placed and self-cancelled while a session is open.
- Whoever fetches the round marks orders **served**, which records each person's consumption and deducts the cans from stock. Any member can do this, not just admins.
- **Purchases** are bulk orders. Recording one does not change stock; marking it delivered does. The person who paid is credited.
- **Reimbursement periods** are monthly. Each item is billed at its own weighted-average purchase price, and the period's payment lines are frozen once generated so a later order never reshuffles a settled month.
- Roles are **per office**: ADMIN in one office grants nothing in another. Tools prefixed \`matecrew_admin_\` require ADMIN in the office being acted on.

Working habits:
- Call \`matecrew_whoami\` when you do not know the user's offices, and \`matecrew_get_today\` before ordering — it says whether a session is actually open.
- Identify people by email where a tool accepts it; names are ambiguous.
- Confirm with the user before anything that destroys records — deleting a reimbursement period, removing a member — and before recording money (purchases, settled payments).
- Tool errors are written to be read: they usually name the valid options. Act on them rather than retrying the same call.`;

/**
 * Registers every MateCrew tool on a fresh MCP server instance. Called once per
 * request by the stateless transport in `/api/mcp`.
 *
 * Tool authorization lives in each tool (via `resolveOffice` /
 * `resolveAdminOffice`), not here — the full list is advertised to every caller,
 * and admin tools refuse at call time with an explanation. That way an admin who
 * gains the role mid-session does not need to reconnect, and a non-admin gets a
 * usable reason instead of a mysteriously absent tool.
 */
export function registerMateCrewTools(server: McpServer): void {
  // Discovery and identity
  registerAccountTools(server);
  registerCatalogTools(server);

  // The daily loop
  registerOrderTools(server);
  registerRunnerTools(server);
  registerConsumptionTools(server);
  registerStatsTools(server);
  registerReimbursementTools(server);

  // Office administration
  registerAdminStockTools(server);
  registerAdminItemTools(server);
  registerAdminPurchaseTools(server);
  registerAdminConsumptionTools(server);
  registerAdminMemberTools(server);
  registerAdminScheduleTools(server);
  registerAdminOfficeTools(server);
  registerAdminReimbursementTools(server);
}
