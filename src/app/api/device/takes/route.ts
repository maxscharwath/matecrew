import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { takesRequest } from "@/lib/device/contract";
import { applyTakes } from "@/lib/device/takes";

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();
  const parsed = takesRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  return Response.json(await applyTakes(device, parsed.data.takes));
}
