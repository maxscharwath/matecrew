import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { downloadableApp } from "@/lib/device/state";

/** Precompiled app bytecode from `device/dist`. Never renders or compiles a screen on the server. */
export async function GET(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();
  const app = downloadableApp();
  if (!app) return new Response("No downloadable app configured", { status: 404 });
  const bytes = await readFile(join(process.cwd(), "device/dist", `${app}.dui`));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.device-ui",
      "Cache-Control": "private, no-cache",
    },
  });
}
