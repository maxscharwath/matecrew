import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;

  // Protected routes — redirect to sign-in if no session
  if (
    pathname.startsWith("/request") ||
    pathname.startsWith("/runner") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/admin")
  ) {
    if (!sessionCookie) {
      return NextResponse.redirect(new URL("/sign-in", request.url));
    }
  }

  // Redirect authenticated users away from auth pages
  if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) {
    if (sessionCookie) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/request/:path*",
    "/runner/:path*",
    "/dashboard/:path*",
    "/admin/:path*",
    "/sign-in",
    "/sign-up",
  ],
};
