import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getActiveCampaignId } from "@/lib/active-campaign";
import { isSecureRequest, campaignCookieOptions, IG_OAUTH_CAMPAIGN_COOKIE } from "@/lib/auth-session";
import {
  buildInstagramAuthUrl,
  getInstagramConfig,
} from "@/lib/instagram";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = getInstagramConfig(request);
  if (!config.configured) {
    return NextResponse.json(
      {
        error:
          "Meta Instagram is not configured. Add INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET (or META_*) in Railway env vars.",
      },
      { status: 503 },
    );
  }

  const campaignId = await getActiveCampaignId();
  if (!campaignId) {
    return NextResponse.json(
      { error: "Select a campaign before connecting Instagram." },
      { status: 400 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const url = buildInstagramAuthUrl(state, config.redirectUri);
  const secure = isSecureRequest(request);
  const response = NextResponse.redirect(url);
  response.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 10,
  });
  response.cookies.set(
    IG_OAUTH_CAMPAIGN_COOKIE,
    campaignId,
    campaignCookieOptions(secure),
  );
  return response;
}
