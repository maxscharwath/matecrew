import { prisma } from "@/lib/prisma";
import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { FRAME_BYTES, frameHash } from "@/lib/device/commands";

/**
 * The terminal reports what its panel now shows, in the format of
 * the local Rust renderer. The console on the site mirrors it.
 */
export async function PUT(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();

  const bits = new Uint8Array(await request.arrayBuffer());
  if (bits.length !== FRAME_BYTES) {
    return Response.json({ error: "invalid_request", expected: FRAME_BYTES, got: bits.length }, { status: 400 });
  }
  const frame = { bits, hash: frameHash(bits), drawnAt: new Date() };
  await prisma.$transaction([
    prisma.deviceFrame.upsert({ where: { deviceId: device.id }, create: { deviceId: device.id, ...frame }, update: frame }),
    prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: frame.drawnAt } }),
  ]);
  return new Response(null, { status: 204 });
}
