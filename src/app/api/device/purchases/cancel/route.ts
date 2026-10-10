import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { cancelPurchaseRequest } from "@/lib/device/contract";
import { cancelPurchase } from "@/lib/device/purchases";

/** The badge holder cancels one of their purchases from the terminal, by the site's rules. */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();
  const parsed = cancelPurchaseRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  return Response.json(await cancelPurchase(device, parsed.data.badgeUid, parsed.data.id));
}
