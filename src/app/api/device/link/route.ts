import { prisma } from "@/lib/prisma";
import { getBaseUrl } from "@/lib/base-url";
import {
  LINK_POLL_INTERVAL_SECONDS,
  LINK_TTL_SECONDS,
  formatUserCode,
  newDeviceCode,
  newUserCode,
  sha256,
} from "@/lib/device/codes";
import { linkStartRequest, type LinkStartResponse } from "@/lib/device/contract";

/**
 * A terminal starts linking (RFC 8628 device authorization request). It keeps
 * `device_code` secret and shows `user_code`; an admin approves the code on
 * /link while the terminal polls /api/device/link/token.
 */
export async function POST(request: Request) {
  const parsed = linkStartRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  // Requests nobody approved are dead weight once expired.
  await prisma.deviceLink.deleteMany({
    where: { expiresAt: { lt: new Date() }, redeemedAt: null },
  });

  const deviceCode = newDeviceCode();
  let userCode = newUserCode();
  while (await prisma.deviceLink.findUnique({ where: { userCode }, select: { id: true } })) {
    userCode = newUserCode();
  }

  await prisma.deviceLink.create({
    data: {
      deviceCodeHash: sha256(deviceCode),
      userCode,
      hardwareId: parsed.data.hardwareId,
      expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000),
    },
  });

  const verificationUri = `${getBaseUrl()}/link`;
  const body: LinkStartResponse = {
    device_code: deviceCode,
    user_code: formatUserCode(userCode),
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${formatUserCode(userCode)}`,
    expires_in: LINK_TTL_SECONDS,
    interval: LINK_POLL_INTERVAL_SECONDS,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
