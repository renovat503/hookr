import { stat } from "fs/promises";
import path from "path";

const IG_GRAPH = "https://graph.instagram.com/v21.0";
const IG_OAUTH = "https://api.instagram.com/oauth/access_token";

export function getInstagramConfig() {
  // Instagram Login uses Instagram App ID/Secret from:
  // App Dashboard → Instagram → API setup with Instagram login → Business login settings
  // Falls back to META_* for convenience if INSTAGRAM_* is unset.
  const appId =
    process.env.INSTAGRAM_APP_ID?.trim() ||
    process.env.META_APP_ID?.trim() ||
    "";
  const appSecret =
    process.env.INSTAGRAM_APP_SECRET?.trim() ||
    process.env.META_APP_SECRET?.trim() ||
    "";
  const appUrl = (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

  return {
    appId,
    appSecret,
    appUrl,
    redirectUri: `${appUrl}/api/instagram/callback`,
    configured: Boolean(appId && appSecret),
  };
}

export function buildInstagramAuthUrl(state: string) {
  const { appId, redirectUri } = getInstagramConfig();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: [
      "instagram_business_basic",
      "instagram_business_content_publish",
    ].join(","),
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

async function igGet<T>(
  pathname: string,
  accessToken: string,
  query: Record<string, string> = {},
): Promise<T> {
  const params = new URLSearchParams({ ...query, access_token: accessToken });
  const res = await fetch(`${IG_GRAPH}${pathname}?${params.toString()}`);
  const json = (await res.json()) as T & {
    error?: { message?: string; code?: number };
  };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Instagram API error (${res.status})`);
  }
  return json;
}

async function igPost<T>(
  pathname: string,
  accessToken: string,
  body: Record<string, string>,
): Promise<T> {
  const params = new URLSearchParams({ ...body, access_token: accessToken });
  const res = await fetch(`${IG_GRAPH}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const json = (await res.json()) as T & {
    error?: { message?: string };
  };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Instagram API error (${res.status})`);
  }
  return json;
}

export async function exchangeCodeForLongLivedToken(code: string) {
  const { appId, appSecret, redirectUri } = getInstagramConfig();
  const cleanCode = code.replace(/#_+$/, "");

  const form = new FormData();
  form.append("client_id", appId);
  form.append("client_secret", appSecret);
  form.append("grant_type", "authorization_code");
  form.append("redirect_uri", redirectUri);
  form.append("code", cleanCode);

  const shortRes = await fetch(IG_OAUTH, { method: "POST", body: form });
  const shortJson = (await shortRes.json()) as {
    access_token?: string;
    user_id?: string | number;
    permissions?: string;
    data?: Array<{
      access_token?: string;
      user_id?: string | number;
      permissions?: string;
    }>;
    error_message?: string;
    error?: { message?: string };
  };

  const short =
    shortJson.data?.[0] ??
    (shortJson.access_token
      ? {
          access_token: shortJson.access_token,
          user_id: shortJson.user_id,
          permissions: shortJson.permissions,
        }
      : null);

  if (!shortRes.ok || !short?.access_token) {
    throw new Error(
      shortJson.error_message ||
        shortJson.error?.message ||
        "Failed to exchange Instagram OAuth code.",
    );
  }

  const longRes = await fetch(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: appSecret,
      access_token: short.access_token,
    }).toString()}`,
  );
  const longJson = (await longRes.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!longRes.ok || !longJson.access_token) {
    throw new Error(
      longJson.error?.message || "Failed to create long-lived Instagram token.",
    );
  }

  return {
    accessToken: longJson.access_token,
    expiresIn: longJson.expires_in ?? 60 * 24 * 60 * 60,
    userId: String(short.user_id ?? ""),
  };
}

export type DiscoveredIgAccount = {
  igUserId: string;
  username: string;
  profilePictureUrl?: string | null;
  pageId: string;
  pageName: string;
  accessToken: string;
};

export async function discoverInstagramAccounts(
  userAccessToken: string,
  fallbackUserId?: string,
): Promise<DiscoveredIgAccount[]> {
  const me = await igGet<{
    id?: string;
    user_id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  }>("/me", userAccessToken, {
    fields: "user_id,username,name,profile_picture_url",
  });

  const igUserId = String(me.user_id || me.id || fallbackUserId || "");
  if (!igUserId) {
    throw new Error("Could not read Instagram user id from connected account.");
  }

  return [
    {
      igUserId,
      username: me.username || `ig_${igUserId}`,
      profilePictureUrl: me.profile_picture_url ?? null,
      pageId: igUserId,
      pageName: me.name || "Instagram",
      accessToken: userAccessToken,
    },
  ];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Public base URL Meta can fetch videos from.
 * Instagram Login does NOT support resumable uploads (Facebook Login only),
 * so video_url must be a publicly reachable HTTPS URL.
 */
export function getPublicMediaBaseUrl() {
  const mediaBase = (
    process.env.INSTAGRAM_MEDIA_BASE_URL ||
    process.env.SUPABASE_PUBLIC_MEDIA_BASE ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");

  return mediaBase;
}

export function isPubliclyReachableMediaUrl(url: string) {
  if (!url.startsWith("https://")) return false;
  try {
    const host = new URL(url).hostname;
    return host !== "localhost" && host !== "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Publish a Reel via Instagram Login.
 * Requires a public HTTPS video_url — Meta's servers fetch the file.
 */
export async function publishReelFromLocalFile(options: {
  igUserId: string;
  accessToken: string;
  videoPath: string;
  caption: string;
  publicVideoUrl?: string | null;
}) {
  const videoUrl =
    options.publicVideoUrl ||
    toPublicVideoUrl(
      options.videoPath.includes("/public/")
        ? `/${options.videoPath.split("/public/")[1]}`
        : options.videoPath,
    );

  if (!isPubliclyReachableMediaUrl(videoUrl)) {
    throw new Error(
      "Instagram needs a public HTTPS video URL (it cannot fetch localhost). Set INSTAGRAM_MEDIA_BASE_URL to a tunnel URL that serves /public (e.g. cloudflared/ngrok), then try again.",
    );
  }

  // Ensure the file exists before asking Meta to fetch it
  await stat(options.videoPath);

  return publishReelFromPublicUrl({
    igUserId: options.igUserId,
    accessToken: options.accessToken,
    videoUrl,
    caption: options.caption,
  });
}

async function publishReelFromPublicUrl(options: {
  igUserId: string;
  accessToken: string;
  videoUrl: string;
  caption: string;
}) {
  const container = await igPost<{ id: string }>(
    `/${options.igUserId}/media`,
    options.accessToken,
    {
      media_type: "REELS",
      video_url: options.videoUrl,
      caption: options.caption,
      share_to_feed: "true",
    },
  );

  await waitForContainer(container.id, options.accessToken);

  const published = await igPost<{ id: string }>(
    `/${options.igUserId}/media_publish`,
    options.accessToken,
    { creation_id: container.id },
  );

  return { mediaId: published.id, containerId: container.id };
}

async function waitForContainer(containerId: string, accessToken: string) {
  let status = "IN_PROGRESS";
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(attempt < 5 ? 4000 : 8000);
    const check = await igGet<{ status_code?: string }>(
      `/${containerId}`,
      accessToken,
      { fields: "status_code" },
    );
    status = check.status_code || "IN_PROGRESS";
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`Reel processing failed (${status}).`);
    }
  }
  throw new Error("Timed out waiting for Instagram to process the Reel.");
}

export function publicUrlToAbsolutePath(publicUrl: string) {
  return path.join(process.cwd(), "public", publicUrl.replace(/^\//, ""));
}

export function toPublicVideoUrl(publicPath: string) {
  if (publicPath.startsWith("http://") || publicPath.startsWith("https://")) {
    return publicPath;
  }
  const base = getPublicMediaBaseUrl();
  return `${base}${publicPath.startsWith("/") ? publicPath : `/${publicPath}`}`;
}
