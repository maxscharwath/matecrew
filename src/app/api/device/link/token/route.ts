import { prisma } from "@/lib/prisma";
import { LINK_POLL_INTERVAL_SECONDS, newDeviceToken, sha256 } from "@/lib/device/codes";
import {
  linkTokenRequest,
  type LinkTokenError,
  type LinkTokenResponse,
} from "@/lib/device/contract";

const noStore = { "Cache-Control": "no-store" };

function linkError(error: LinkTokenError) {
  return Response.json({ error }, { status: 400, headers: noStore });
}

/**
 * The terminal polls with its device code (RFC 8628 §3.4). Once an admin has
 * approved the link, the first poll creates the `Device` and returns its
 * token, the only time the token exists in clear on the server.
 */
export async function POST(request: Request) {
  const parsed = linkTokenRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return linkError("invalid_grant");

  const link = await prisma.deviceLink.findUnique({
    where: { deviceCodeHash: sha256(parsed.data.device_code) },
    include: { office: true },
  });
  if (!link || link.redeemedAt) return linkError("invalid_grant");
  if (link.deniedAt) return linkError("access_denied");
  if (link.expiresAt < new Date()) return linkError("expired_token");

  const now = new Date();
  const tooSoon =
    link.lastPolledAt &&
    now.getTime() - link.lastPolledAt.getTime() < (LINK_POLL_INTERVAL_SECONDS - 1) * 1000;
  await prisma.deviceLink.update({ where: { id: link.id }, data: { lastPolledAt: now } });
  if (tooSoon) return linkError("slow_down");
  if (!link.approvedAt || !link.office) return linkError("authorization_pending");

  const token = newDeviceToken();
  const office = link.office;
  const device = await prisma.$transaction(async (tx) => {
    // Redeem first so two racing polls cannot both create a device.
    const redeemed = await tx.deviceLink.updateMany({
      where: { id: link.id, redeemedAt: null },
      data: { redeemedAt: now },
    });
    if (redeemed.count === 0) return null;
    const defaultItem = await tx.item.findFirst({
      where: { officeId: office.id, active: true },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
      select: { id: true },
    });
    return tx.device.create({
      data: {
        officeId: office.id,
        name: link.deviceName ?? "Terminal",
        hardwareId: link.hardwareId,
        tokenHash: sha256(token),
        linkedById: link.approvedById,
        leftItemId: defaultItem?.id ?? null,
      },
    });
  });
  if (!device) return linkError("invalid_grant");

  const body: LinkTokenResponse = {
    access_token: token,
    token_type: "Bearer",
    device_id: device.id,
    device_name: device.name,
    office_name: office.name,
  };
  return Response.json(body, { headers: noStore });
}
