import { adminDevice } from "@/lib/device/admin";
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
  const found = await adminDevice(officeId, deviceId);
  if ("error" in found) return found.error;

  const png = await bitsToPng(await renderScreenBits(await buildScreenData(found.device)));
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
