import { getOptionalSession } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

/**
 * For the admin routes under /org/[officeId]/admin/devices/[deviceId]: the
 * device if the signed-in user is an admin of its office, or the response to
 * send instead.
 */
export async function adminDevice(officeId: string, deviceId: string) {
  const session = await getOptionalSession();
  if (!session) return { error: new Response(null, { status: 401 }) } as const;

  const membership = await prisma.membership.findUnique({
    where: { userId_officeId: { userId: session.user.id, officeId } },
    select: { roles: true },
  });
  if (!membership?.roles.includes("ADMIN")) return { error: new Response(null, { status: 403 }) } as const;

  const device = await prisma.device.findFirst({ where: { id: deviceId, officeId }, include: { office: true } });
  if (!device) return { error: new Response(null, { status: 404 }) } as const;
  return { device, userId: session.user.id } as const;
}
