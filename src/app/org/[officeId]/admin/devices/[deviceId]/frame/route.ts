import { prisma } from "@/lib/prisma";
import { adminDevice } from "@/lib/device/admin";
import { bitsToPng } from "@/lib/device/screen";

/** PNG of what the terminal last reported on its panel; the console's mirror. */
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
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  const png = await bitsToPng(Buffer.from(frame.bits));
  return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
}
