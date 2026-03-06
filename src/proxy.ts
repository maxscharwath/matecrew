import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function proxy(request: NextRequest) {
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

  // Redirect authenticated users away from auth pages
  if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) {
    if (sessionCookie) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/org/:path*", "/sign-in", "/sign-up"],
};
