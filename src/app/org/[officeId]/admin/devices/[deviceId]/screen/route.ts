import { NextResponse } from "next/server";
import { getOptionalSession } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { buildScreenData } from "@/lib/device/state";
import { bitsToPng, renderScreenBits } from "@/lib/device/screen";

/**
 * PNG of the 1-bit screen the device will download, for the admin page.
 * In `bun dev`, editing src/lib/device/screen.tsx and reloading shows the change.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ officeId: string; deviceId: string }> },
) {
  const { officeId, deviceId } = await params;
  const session = await getOptionalSession();
  if (!session) return new NextResponse(null, { status: 401 });

  const membership = await prisma.membership.findUnique({
    where: { userId_officeId: { userId: session.user.id, officeId } },
    select: { roles: true },
  });
  if (!membership?.roles.includes("ADMIN")) return new NextResponse(null, { status: 403 });

  const device = await prisma.device.findFirst({
    where: { id: deviceId, officeId },
    include: { office: true },
  });
  if (!device) return new NextResponse(null, { status: 404 });

  const png = await bitsToPng(await renderScreenBits(await buildScreenData(device)));
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
