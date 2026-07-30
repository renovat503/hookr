import { NextResponse } from "next/server";
import { readRequestCookie } from "@/lib/app-url";
import {
  discoverYouTubeChannels,
  exchangeCodeForTokens,
  getYouTubeConfig,
} from "@/lib/youtube";
import { upsertYouTubeAccounts } from "@/lib/youtube-store";
import { YT_OAUTH_CAMPAIGN_COOKIE } from "@/lib/auth-session";
import type { YouTubeAccount } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = getYouTubeConfig(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error =
    searchParams.get("error_description") || searchParams.get("error");

  const redirectBase = `${config.appUrl}/youtube`;

  if (error) {
    return NextResponse.redirect(
      `${redirectBase}?error=${encodeURIComponent(error)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${redirectBase}?error=${encodeURIComponent("Missing OAuth code.")}`,
    );
  }

  const cookieHeader = request.headers.get("cookie") || "";
  const expected = readRequestCookie(cookieHeader, "yt_oauth_state");
  const campaignId = readRequestCookie(cookieHeader, YT_OAUTH_CAMPAIGN_COOKIE);

  if (!expected || expected !== state) {
    return NextResponse.redirect(
      `${redirectBase}?error=${encodeURIComponent("Invalid OAuth state.")}`,
    );
  }

  if (!campaignId) {
    return NextResponse.redirect(
      `${redirectBase}?error=${encodeURIComponent(
        "Select a campaign before connecting YouTube.",
      )}`,
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code, config.redirectUri);
    const channels = await discoverYouTubeChannels(tokens.accessToken);

    if (!channels.length) {
      return NextResponse.redirect(
        `${redirectBase}?error=${encodeURIComponent(
          "No YouTube channel found for this Google account.",
        )}`,
      );
    }

    const now = Date.now();
    const accounts: YouTubeAccount[] = channels.map((channel) => ({
      id: `yt-${campaignId}-${channel.channelId}`,
      campaignId,
      channelId: channel.channelId,
      channelTitle: channel.channelTitle,
      thumbnailUrl: channel.thumbnailUrl,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      connectedAt: new Date().toISOString(),
      tokenExpiresAt: new Date(now + tokens.expiresIn * 1000).toISOString(),
    }));

    await upsertYouTubeAccounts(accounts);

    const response = NextResponse.redirect(
      `${redirectBase}?connected=${accounts.length}`,
    );
    response.cookies.set("yt_oauth_state", "", { path: "/", maxAge: 0 });
    response.cookies.set(YT_OAUTH_CAMPAIGN_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to connect YouTube.";
    return NextResponse.redirect(
      `${redirectBase}?error=${encodeURIComponent(message)}`,
    );
  }
}
