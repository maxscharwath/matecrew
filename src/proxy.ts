import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;

  // Protected routes — redirect to sign-in if no session
  if (pathname.startsWith("/org/")) {
    if (!sessionCookie) {
      const signInUrl = new URL("/sign-in", request.url);
      signInUrl.searchParams.set("redirectTo", pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  // Auth pages send signed-in users away themselves: only they can tell a
  // valid session from a stale cookie, and redirecting on the cookie alone
  // loops between /sign-in and / when the cookie is stale.

  return NextResponse.next();
}

export const config = {
  matcher: ["/org/:path*"],
};
