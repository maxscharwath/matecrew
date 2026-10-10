import { prisma } from "@/lib/prisma";
import { adminDevice } from "@/lib/device/admin";

/**
 * What the terminal last reported on its panel, for the console's mirror and
 * the device list's thumbnail: the 800 × 480 1-bit frame as it came (packed
 * MSB first, 1 = ink), base64 in JSON. The browser draws it on a canvas.
 * JSON rather than octet-stream because Vercel's CDN only compresses an
 * allowlist of types: a mostly blank panel's 48 000 bytes then travel as a few KB.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ officeId: string; deviceId: string }> },
) {
  const { officeId, deviceId } = await params;
  const found = await adminDevice(officeId, deviceId);
  if ("error" in found) return found.error;

  const frame = await prisma.deviceFrame.findUnique({ where: { deviceId } });
  if (!frame) return new Response(null, { status: 404 });

  const etag = `"${frame.hash}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (matches(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return Response.json(
    {
      hash: frame.hash,
      drawnAt: frame.drawnAt.toISOString(),
      width: 800,
      height: 480,
      bits: Buffer.from(frame.bits).toString("base64"),
    },
    { headers },
  );
}

/** If-None-Match may list several tags, and a compressing proxy may have weakened ours. */
function matches(header: string | null, etag: string): boolean {
  return !!header && header.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag);
}
