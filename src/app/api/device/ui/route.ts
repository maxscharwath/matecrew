import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { authenticateDevice, unauthorized } from "@/lib/device/auth";

/** Precompiled app bytecode. Never renders or compiles a screen on the server. */
export async function GET(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();
  if (new URL(request.url).searchParams.get("app") === "showcase") {
    const bytes = await readFile(
      join(process.cwd(), "device/apps/showcase/app.dui"),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.device-ui",
        "Cache-Control": "private, no-cache",
      },
    });
  }
  const file =
    process.env.DEVICE_UI_APP === "kit" ? "kit-demo.dui" : "example.dui";
  const bytes = await readFile(join(process.cwd(), "device/screens", file));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.device-ui",
      "Cache-Control": "private, no-cache",
    },
  });
}
