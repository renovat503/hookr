import { getActiveCampaignId } from "@/lib/active-campaign";
import { getCampaign } from "@/lib/campaign-store";
import { isSecureRequest, campaignCookieOptions, YT_OAUTH_CAMPAIGN_COOKIE } from "@/lib/auth-session";
import {
  buildYouTubeAuthUrl,
  createYouTubeOAuthState,
  getYouTubeConfig,
} from "@/lib/youtube";
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

  const requestedCampaignId = new URL(request.url).searchParams.get("campaignId")?.trim();
  const campaignId =
    (requestedCampaignId && (await getCampaign(requestedCampaignId))?.id) ||
    (await getActiveCampaignId());
  if (!campaignId) {
    return NextResponse.json(
      { error: "Select a campaign before connecting YouTube." },
      { status: 400 },
    );
  }

  const state = createYouTubeOAuthState(campaignId);
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
