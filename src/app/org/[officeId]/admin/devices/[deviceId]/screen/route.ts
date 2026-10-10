import { adminDevice } from "@/lib/device/admin";
import { buildScreenData } from "@/lib/device/state";

/** Definition for a browser preview drawn by the same Rust/Wasm renderer as the device. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ officeId: string; deviceId: string }> },
) {
  const { officeId, deviceId } = await params;
  const found = await adminDevice(officeId, deviceId);
  if ("error" in found) return found.error;

  return Response.json(await buildScreenData(found.device), { headers: { "Cache-Control": "no-store" } });
}
