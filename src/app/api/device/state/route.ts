import { prisma } from "@/lib/prisma";
import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { buildDeviceState } from "@/lib/device/state";

/** Everything the terminal needs to work offline until its next sync. */
export async function GET(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();
  await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return Response.json(await buildDeviceState(device), { headers: { "Cache-Control": "no-store" } });
}
