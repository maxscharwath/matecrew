import { prisma } from "@/lib/prisma";
import { platform } from "@/platform";
import { authenticateDevice, unauthorized } from "@/lib/device/auth";

/**
 * A firmware image for an update over the network, to linked terminals only.
 * The state announces the version, size and SHA-256; the terminal checks
 * both before it switches to the new image.
 */
export async function GET(request: Request, { params }: { params: Promise<{ version: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();

  const { version } = await params;
  const release = await prisma.firmwareRelease.findUnique({ where: { version } });
  if (!release) return Response.json({ error: "not_found" }, { status: 404 });

  const image = await platform.storage.get(release.storageKey);
  if (!image) return Response.json({ error: "not_found" }, { status: 404 });
  return new Response(image.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(release.size),
      "Cache-Control": "no-store",
    },
  });
}
