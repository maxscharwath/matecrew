import { auth } from "@/lib/auth";
import { sameLoopbackCallback } from "@/lib/mcp/loopback";
import { prisma } from "@/lib/prisma";

/**
 * OAuth token endpoint — Better Auth's `/mcp/token`, fronted by a shim that
 * forgives the host spelling of a loopback `redirect_uri`.
 *
 * Better Auth requires the exchange to present the same `redirect_uri` string
 * the code was issued for. A native client cannot always honour that: it
 * authorizes through the browser, where Vercel's edge rewrites `127.0.0.1` to
 * `localhost` in that query parameter, then exchanges the code from its own
 * process, where the URI travels in the body and arrives exactly as the client
 * wrote it. The two spellings disagree and the exchange is refused — the
 * browser reports a successful sign-in while the app reports a failed one.
 *
 * So when the presented URI is the same loopback callback as the stored one —
 * same port, same path, both loopback — the body is rewritten to the stored
 * spelling before Better Auth compares them. A different port, a different
 * path, or a non-loopback host still fails, and nothing else in the body is
 * touched.
 *
 * Being the more specific route, this file takes precedence over the
 * `[...all]` catch-all; both hand off to the same `auth.handler`.
 */

// Prisma needs Node APIs, so this cannot run on the edge.
export const runtime = "nodejs";

/** The `redirect_uri` the authorization code was issued for, if any. */
async function issuedRedirectUri(code: string): Promise<string | null> {
  const verification = await prisma.verification.findUnique({
    where: { identifier: code },
    select: { value: true },
  });
  if (!verification) return null;
  try {
    const stored: unknown = JSON.parse(verification.value);
    const uri = (stored as { redirectURI?: unknown }).redirectURI;
    return typeof uri === "string" ? uri : null;
  } catch {
    return null;
  }
}

/**
 * Returns the request Better Auth should see. The body has to be read to be
 * inspected, so it is always rebuilt — with `redirect_uri` swapped for the
 * stored spelling when the two describe the same loopback callback.
 */
async function reconcileLoopback(request: Request): Promise<Request> {
  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("json");
  const raw = await request.text();

  const rebuild = (body: string) => {
    const headers = new Headers(request.headers);
    // The rewrite changes the body's length; let it be recomputed.
    headers.delete("content-length");
    return new Request(request.url, { method: "POST", headers, body });
  };

  let params: Record<string, unknown>;
  try {
    params = isJson
      ? JSON.parse(raw)
      : Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return rebuild(raw);
  }

  const { grant_type: grantType, code, redirect_uri: presented } = params;
  if (
    grantType !== "authorization_code" ||
    typeof code !== "string" ||
    typeof presented !== "string"
  ) {
    return rebuild(raw);
  }

  const issued = await issuedRedirectUri(code);
  if (!issued || issued === presented) return rebuild(raw);
  if (!sameLoopbackCallback(issued, presented)) return rebuild(raw);

  if (isJson) {
    return rebuild(JSON.stringify({ ...params, redirect_uri: issued }));
  }
  const form = new URLSearchParams(raw);
  form.set("redirect_uri", issued);
  return rebuild(form.toString());
}

export async function POST(request: Request): Promise<Response> {
  return auth.handler(await reconcileLoopback(request));
}
