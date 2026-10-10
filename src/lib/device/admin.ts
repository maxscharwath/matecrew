import { getOptionalSession } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { hasRoleWhere } from "@/lib/membership-roles";
import { withOwnLocale } from "@/lib/device/auth";

/**
 * For the admin routes under /org/[officeId]/admin/devices/[deviceId]: the
 * device if the signed-in user is an admin of its office, or the response to
 * send instead.
 */
export async function adminDevice(officeId: string, deviceId: string) {
  const session = await getOptionalSession();
  if (!session) return { error: new Response(null, { status: 401 }) } as const;

  const admin = await prisma.membership.findFirst({
    where: { userId: session.user.id, officeId, ...hasRoleWhere("ADMIN") },
    select: { id: true },
  });
  if (!admin) return { error: new Response(null, { status: 403 }) } as const;

  const device = await prisma.device.findFirst({ where: { id: deviceId, officeId }, include: { office: true } });
  if (!device) return { error: new Response(null, { status: 404 }) } as const;
  // What the site renders for it (the screen preview) in the language it shows.
  return { device: withOwnLocale(device), userId: session.user.id } as const;
}
