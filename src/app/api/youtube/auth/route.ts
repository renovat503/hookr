import { getActiveCampaignId } from "@/lib/active-campaign";
import { isSecureRequest, campaignCookieOptions, YT_OAUTH_CAMPAIGN_COOKIE } from "@/lib/auth-session";
import { buildYouTubeAuthUrl, getYouTubeConfig } from "@/lib/youtube";
import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = getYouTubeConfig(request);
  if (!config.configured) {
    return NextResponse.json(
      {
        error:
          "YouTube is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env vars.",
      },
      { status: 503 },
    );
  }

  const campaignId = await getActiveCampaignId();
  if (!campaignId) {
    return NextResponse.json(
      { error: "Select a campaign before connecting YouTube." },
      { status: 400 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const url = buildYouTubeAuthUrl(state, config.redirectUri);
  const secure = isSecureRequest(request);
  const response = NextResponse.redirect(url);
  response.cookies.set("yt_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 10,
  });
  response.cookies.set(
    YT_OAUTH_CAMPAIGN_COOKIE,
    campaignId,
    campaignCookieOptions(secure),
  );
  return response;
}
