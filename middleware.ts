import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  CAMPAIGN_COOKIE,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/auth";

function isPublic(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname === "/api/auth/login") return true;
  if (pathname.startsWith("/api/instagram/callback")) return true;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/characters/") ||
    /\.(ico|png|jpg|jpeg|svg|webp|woff2?)$/.test(pathname)
  ) {
    return true;
  }
  return false;
}

function needsActiveCampaign(pathname: string): boolean {
  if (pathname.startsWith("/campaigns")) return false;
  if (pathname.startsWith("/login")) return false;
  if (pathname.startsWith("/api/")) return false;
  return (
    pathname.startsWith("/create") ||
    pathname.startsWith("/produce") ||
    pathname.startsWith("/library") ||
    pathname.startsWith("/instagram") ||
    pathname.startsWith("/campaign/") ||
    pathname === "/"
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(session)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (needsActiveCampaign(pathname)) {
    const campaign = request.cookies.get(CAMPAIGN_COOKIE)?.value?.trim();
    if (!campaign) {
      const campaigns = new URL("/campaigns", request.url);
      if (pathname !== "/") {
        campaigns.searchParams.set("next", pathname);
      }
      return NextResponse.redirect(campaigns);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
