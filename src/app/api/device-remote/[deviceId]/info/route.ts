import { prisma } from "@/lib/prisma";
import { adminDevice } from "@/lib/device/admin";
import { isReachable } from "@/lib/device/commands";

/**
 * A terminal's info for `HttpRemote` (`@matecrew/device-link`), for an admin of its office:
 * what the site last heard from it. Does not count as watching the console.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const owner = await prisma.device.findUnique({ where: { id: deviceId }, select: { officeId: true } });
  if (!owner) return new Response(null, { status: 404 });
  const found = await adminDevice(owner.officeId, deviceId);
  if ("error" in found) return found.error;
  const { device } = found;
  return Response.json(
    {
      id: device.id,
      name: device.name,
      hardwareId: device.hardwareId,
      firmware: device.firmwareVersion,
      batteryMv: device.batteryMv,
      wifiRssi: device.wifiRssi,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      reachable: isReachable(device.polledAt),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
