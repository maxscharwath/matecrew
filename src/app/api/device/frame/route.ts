import { commitBatch } from "@/lib/prisma";
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
  const hash = frameHash(bits);
  const drawnAt = new Date();
  // One atomic batch: the frame (an upsert in one statement, standard on SQLite
  // and Postgres) and the time the terminal was last seen. Nothing is read.
  await commitBatch((db) => [
    db.$executeRaw`INSERT INTO "DeviceFrame" ("deviceId", "bits", "hash", "drawnAt")
      VALUES (${device.id}, ${bits}, ${hash}, ${drawnAt})
      ON CONFLICT ("deviceId")
      DO UPDATE SET "bits" = excluded."bits", "hash" = excluded."hash", "drawnAt" = excluded."drawnAt"`,
    db.device.updateMany({ where: { id: device.id }, data: { lastSeenAt: drawnAt } }),
  ]);
  return new Response(null, { status: 204 });
}
