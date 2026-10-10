import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { accountRequest } from "@/lib/device/contract";
import { buildAccount } from "@/lib/device/account";
import { badgeHolder } from "@/lib/device/purchases";

/**
 * The badge holder's account for the terminal's "Mon compte" (right key): what they drank and
 * bought, counted now. A POST so the badge stays out of URLs and access logs. A badge nobody holds
 * in the terminal's office is a 404 `unknown_badge`, which the terminal tells apart from a site
 * error.
 */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();
  const parsed = accountRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  const userId = await badgeHolder(device, parsed.data.badgeUid);
  if (!userId) return Response.json({ error: "unknown_badge" }, { status: 404 });
  return Response.json(await buildAccount(device, userId), { headers: { "Cache-Control": "no-store" } });
}
