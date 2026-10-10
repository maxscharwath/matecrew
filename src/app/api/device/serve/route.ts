import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { serveRequest } from "@/lib/device/contract";
import { serveFromDevice } from "@/lib/device/serve";

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();
  const parsed = serveRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  return Response.json(await serveFromDevice(device, parsed.data));
}
