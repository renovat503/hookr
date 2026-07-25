import { NextResponse } from "next/server";
import {
  CAMPAIGN_COOKIE,
  clearSessionCookieOptions,
  isSecureRequest,
  SESSION_COOKIE,
} from "@/lib/auth-session";

export async function POST(request: Request) {
  const secure = isSecureRequest(request);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", clearSessionCookieOptions(secure));
  res.cookies.set(CAMPAIGN_COOKIE, "", {
    ...clearSessionCookieOptions(secure),
    maxAge: 0,
  });
  return res;
}
