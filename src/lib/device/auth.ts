import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/device/codes";

/**
 * The linked terminal behind a request's bearer token, or null. Only the
 * token's hash is stored, so the lookup is by hash. A terminal set to its own
 * language gets it as `office.locale`: every text the site words for it
 * (screens, key labels, purchase dates) follows without each one asking.
 */
export async function authenticateDevice(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(mcd_[A-Za-z0-9_-]{20,})$/.exec(header);
  if (!match) return null;
  const device = await prisma.device.findUnique({
    where: { tokenHash: sha256(match[1]) },
    include: { office: true },
  });
  return device && withOwnLocale(device);
}

/** The terminal with its own language, when it has one, in place of its office's. */
export function withOwnLocale<T extends { locale: string | null; office: { locale: string } }>(device: T): T {
  return device.locale ? { ...device, office: { ...device.office, locale: device.locale } } : device;
}

export type AuthenticatedDevice = NonNullable<Awaited<ReturnType<typeof authenticateDevice>>>;

export function unauthorized(): Response {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="matecrew-device"' } },
  );
}
