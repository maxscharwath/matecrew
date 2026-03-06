import { NextRequest, NextResponse } from "next/server";
import { downloadFile } from "@/lib/storage";

const CACHE_DURATION = 60 * 60; // 1 hour

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const storageKey = key.join("/");

  try {
    const { body, contentType } = await downloadFile(storageKey);

    return new NextResponse(body as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `private, max-age=${CACHE_DURATION}, immutable`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
