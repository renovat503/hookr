import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import {
  buildInstagramAuthUrl,
  getInstagramConfig,
} from "@/lib/instagram";

export const runtime = "nodejs";

export async function GET() {
  const config = getInstagramConfig();
  if (!config.configured) {
    return NextResponse.json(
      {
        error:
          "Meta Instagram is not configured. Add META_APP_ID and META_APP_SECRET to .env.local.",
      },
      { status: 503 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const url = buildInstagramAuthUrl(state);
  const response = NextResponse.redirect(url);
  response.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
