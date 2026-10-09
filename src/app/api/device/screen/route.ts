import { createHash } from "node:crypto";
import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { buildScreenData } from "@/lib/device/state";
import { renderScreenBits } from "@/lib/device/screen";

/**
 * The main screen as 48 000 bytes of packed 1-bit pixels (see screen.tsx).
 * The terminal sends the ETag it last drew and gets 304 when nothing changed,
 * which spares it a full e-ink refresh.
 */
export async function GET(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();

  const bits = await renderScreenBits(await buildScreenData(device));
  const etag = `"${createHash("sha256").update(bits).digest("base64url").slice(0, 22)}"`;
  const headers = { ETag: etag, "Cache-Control": "no-store" };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(new Uint8Array(bits), {
    headers: { ...headers, "Content-Type": "application/octet-stream" },
  });
}
