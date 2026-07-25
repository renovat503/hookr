import { NextResponse } from "next/server";
import {
  discoverInstagramAccounts,
  exchangeCodeForLongLivedToken,
  getInstagramConfig,
} from "@/lib/instagram";
import { upsertInstagramAccounts } from "@/lib/instagram-store";
import type { InstagramAccount } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = getInstagramConfig();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error =
    searchParams.get("error_description") || searchParams.get("error");

  const redirectBase = `${config.appUrl}/instagram`;

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
  const expected = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("ig_oauth_state="))
    ?.split("=")[1];

  if (!expected || expected !== state) {
    return NextResponse.redirect(
      `${redirectBase}?error=${encodeURIComponent("Invalid OAuth state.")}`,
    );
  }

  try {
    const { accessToken, expiresIn, userId } =
      await exchangeCodeForLongLivedToken(code);
    const discovered = await discoverInstagramAccounts(accessToken, userId);

    if (!discovered.length) {
      return NextResponse.redirect(
        `${redirectBase}?error=${encodeURIComponent(
          "No Instagram professional account found. Switch the account to Business or Creator, then try again.",
        )}`,
      );
    }

    const now = Date.now();
    const accounts: InstagramAccount[] = discovered.map((item) => ({
      id: `ig-${item.igUserId}`,
      igUserId: item.igUserId,
      username: item.username,
      profilePictureUrl: item.profilePictureUrl,
      pageId: item.pageId,
      pageName: item.pageName,
      accessToken: item.accessToken,
      connectedAt: new Date().toISOString(),
      tokenExpiresAt: new Date(now + expiresIn * 1000).toISOString(),
    }));

    await upsertInstagramAccounts(accounts);

    const response = NextResponse.redirect(
      `${redirectBase}?connected=${accounts.length}`,
    );
    response.cookies.set("ig_oauth_state", "", { path: "/", maxAge: 0 });
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to connect Instagram.";
    return NextResponse.redirect(
      `${redirectBase}?error=${encodeURIComponent(message)}`,
    );
  }
}
