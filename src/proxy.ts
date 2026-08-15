import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

/** The sign-in door itself, which obviously cannot be behind the lock. */
const OPEN = new Set(["/login", "/logout"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (OPEN.has(pathname)) return NextResponse.next();
  if (verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  // A stale tab polling the API should get an answer it can read, not HTML.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const wanted = `${pathname}${search}`;
  if (wanted !== "/") url.searchParams.set("next", wanted);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the build output and static assets — the app's own pages,
  // API routes and server functions all pass through here.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
