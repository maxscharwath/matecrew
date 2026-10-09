import { adminDevice } from "@/lib/device/admin";
import { loadLiveStatus } from "@/lib/device/live";

/** Polled every second by the console while it is open. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ officeId: string; deviceId: string }> },
) {
  const { officeId, deviceId } = await params;
  const found = await adminDevice(officeId, deviceId);
  if ("error" in found) return found.error;
  return Response.json(await loadLiveStatus(deviceId), { headers: { "Cache-Control": "no-store" } });
}
