import { prisma } from "@/lib/prisma";
import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { normalizeBadgeUid } from "@/lib/device/codes";
import { statusRequest } from "@/lib/device/contract";
import { recordBadges } from "@/lib/device/takes";

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();
  const parsed = statusRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { firmwareVersion, batteryMv, wifiRssi, unknownBadges } = parsed.data;

  await prisma.device.update({
    where: { id: device.id },
    data: { firmwareVersion, batteryMv, wifiRssi, lastSeenAt: new Date() },
  });
  const uids = unknownBadges.map(normalizeBadgeUid).filter((uid): uid is string => uid !== null);
  await recordBadges(device.officeId, uids);

  return Response.json({ ok: true });
}
