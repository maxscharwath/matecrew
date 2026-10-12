import terminal from "../../../../../assets/models/matecrew-terminal.glb" with { type: "bytes" };
import { getOptionalSession } from "@/lib/auth-utils";

/**
 * The terminal's 3D model (src/components/device-3d-scene.tsx). It carries the board makers' own
 * models, which may not be redistributed, so it lives outside public/ and only signed-in users get
 * it. Bundled with the server like the device apps (src/app/api/device/ui/route.ts): no
 * filesystem on Workers, the same on Vercel and in local dev.
 *
 * Cached by the browser only (`private`), revalidated on each use against its ETag: a new model
 * arrives with the next deploy, and an unchanged one costs a 304.
 */

let etag: Promise<string> | null = null;

function etagOfModel(): Promise<string> {
  etag ??= crypto.subtle.digest("SHA-256", terminal).then((digest) => {
    const hex = [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `"${hex}"`;
  });
  return etag;
}

export async function GET(request: Request) {
  const session = await getOptionalSession();
  if (!session) return Response.json({ error: "Sign in to see the model" }, { status: 401 });

  const tag = await etagOfModel();
  const headers = { ETag: tag, "Cache-Control": "private, no-cache", Vary: "Cookie" };
  if (request.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers });
  return new Response(terminal, {
    headers: { ...headers, "Content-Type": "model/gltf-binary", "Content-Length": String(terminal.byteLength) },
  });
}
