import { NextRequest, NextResponse } from "next/server";
import { downloadFile } from "@/lib/storage";
import { getOptionalSession } from "@/lib/auth-utils";

/**
 * Serves a stored file by its storage key.
 *
 * Caching is the main lever on storage cost: every uncached request is a fetch
 * against the blob store (a billed operation plus data transfer), and avatars
 * and item images are re-requested on nearly every page render. Keys embed a
 * UUID and their content never changes, so anything cacheable can be cached
 * effectively forever — a shared CDN cache then serves repeat views and the
 * store is touched roughly once per file.
 *
 * Two classes of file share this route and they cannot share a cache policy:
 *
 * - `avatars/` and `items/` are shown to everyone and are also fetched
 *   server-side by Slack when it renders message images, so they must stay
 *   unauthenticated and are safe to cache publicly.
 * - `invoices/` and `reimbursements/` are financial documents. They stay out of
 *   shared caches and require a session.
 */

const YEAR_SECONDS = 60 * 60 * 24 * 365;
const HOUR_SECONDS = 60 * 60;

/**
 * Prefixes served without a session. Slack fetches these with no cookies to
 * render item and avatar thumbnails, so requiring auth here would silently
 * break the daily message.
 */
const PUBLIC_PREFIXES = ["avatars/", "items/"] as const;

function isPublicKey(key: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const storageKey = key.join("/");

  const isPublic = isPublicKey(storageKey);

  if (!isPublic) {
    // Settlement PDF keys are derivable from ids the app shows in its own UI
    // (`reimbursements/<version>/<periodId>/user-<userId>.pdf`), so an
    // unauthenticated route would hand them to anyone who worked out the shape.
    const session = await getOptionalSession();
    if (!session) {
      // 404 rather than 401: don't confirm that a given key exists.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  try {
    const { body, contentType } = await downloadFile(storageKey);

    return new NextResponse(body as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": isPublic
          ? // Shared caches may serve this, so the store is hit about once per
            // file rather than once per viewer per hour.
            `public, max-age=${YEAR_SECONDS}, immutable`
          : `private, max-age=${HOUR_SECONDS}, immutable`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
