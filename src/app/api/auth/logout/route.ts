import { NextResponse } from "next/server";
import {
  CAMPAIGN_COOKIE,
  clearSessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth";

export async function POST(request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  const res = NextResponse.json({ ok: true });
  res.cookies.set("hookr_session", "", clearSessionCookieOptions(secure));
  res.cookies.set(CAMPAIGN_COOKIE, "", { ...clearSessionCookieOptions(secure), maxAge: 0 });
  return res;
}
