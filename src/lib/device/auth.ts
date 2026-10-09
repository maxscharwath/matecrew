import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/device/codes";

/**
 * The linked terminal behind a request's bearer token, or null. Only the
 * token's hash is stored, so the lookup is by hash.
 */
export async function authenticateDevice(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(mcd_[A-Za-z0-9_-]{20,})$/.exec(header);
  if (!match) return null;
  return prisma.device.findUnique({
    where: { tokenHash: sha256(match[1]) },
    include: { office: true },
  });
}

export type AuthenticatedDevice = NonNullable<Awaited<ReturnType<typeof authenticateDevice>>>;

export function unauthorized(): Response {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="matecrew-device"' } },
  );
}
