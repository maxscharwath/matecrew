import { adminDevice } from "@/lib/device/admin";
import { loadLiveStatus } from "@/lib/device/live";

/**
 * Polled every second by the console while it is open. `?watch=0` while the console has the
 * screen over Bluetooth: the terminal then stops uploading it over Wi-Fi.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ officeId: string; deviceId: string }> },
) {
  const { officeId, deviceId } = await params;
  const found = await adminDevice(officeId, deviceId);
  if ("error" in found) return found.error;
  const watch = new URL(request.url).searchParams.get("watch") !== "0";
  return Response.json(await loadLiveStatus(deviceId, new Date(), { watch }), { headers: { "Cache-Control": "no-store" } });
}
