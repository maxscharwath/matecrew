import hello from "../../../../../device/dist/hello.dui" with { type: "bytes" };
import showcase from "../../../../../device/dist/showcase.dui" with { type: "bytes" };
import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { downloadableApp } from "@/lib/device/state";

/** The precompiled apps, bundled with the server: no filesystem on Workers. */
const APPS: Record<NonNullable<ReturnType<typeof downloadableApp>>, Uint8Array> = { hello, showcase };

/** Precompiled app bytecode from `device/dist`. Never renders or compiles a screen on the server. */
export async function GET(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();
  const app = downloadableApp();
  if (!app) return new Response("No downloadable app configured", { status: 404 });
  return new Response(new Uint8Array(APPS[app]), {
    headers: {
      "Content-Type": "application/vnd.device-ui",
      "Cache-Control": "private, no-cache",
    },
  });
}
