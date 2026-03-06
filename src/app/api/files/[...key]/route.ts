import { NextRequest, NextResponse } from "next/server";
import storage from "@/lib/storage";

const CACHE_DURATION = 60 * 60; // 1 hour

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const storageKey = key.join("/");

  try {
    const url = await storage.getSignedUrl(storageKey);
    const res = await fetch(url);

    if (!res.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = res.body;
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `private, max-age=${CACHE_DURATION}, immutable`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
