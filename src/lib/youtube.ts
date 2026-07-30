import { stat } from "fs/promises";
import { readFile } from "fs/promises";
import { resolveAppUrl, youtubeOAuthRedirectUri } from "./app-url";
import type { YouTubeAccount } from "./types";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const YT_API = "https://www.googleapis.com/youtube/v3";
const YT_UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";

const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export function getYouTubeConfig(request?: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  const appUrl = resolveAppUrl(request);

  return {
    clientId,
    clientSecret,
    appUrl,
    redirectUri: youtubeOAuthRedirectUri(request),
    configured: Boolean(clientId && clientSecret),
  };
}

export function buildYouTubeAuthUrl(state: string, redirectUri: string) {
  const { clientId } = getYouTubeConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YT_SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getYouTubeConfig();
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description || json.error || "Failed to exchange Google OAuth code.",
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresIn: json.expires_in ?? 3600,
  };
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getYouTubeConfig();
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description || json.error || "Failed to refresh YouTube token.",
    );
  }
  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in ?? 3600,
  };
}

export async function ensureFreshAccessToken(
  account: YouTubeAccount,
  persist?: (patch: Pick<YouTubeAccount, "accessToken" | "tokenExpiresAt">) => Promise<void>,
): Promise<string> {
  const expiresAt = account.tokenExpiresAt
    ? new Date(account.tokenExpiresAt).getTime()
    : 0;
  const needsRefresh = !expiresAt || expiresAt - Date.now() < 5 * 60 * 1000;
  if (!needsRefresh) return account.accessToken;
  if (!account.refreshToken) return account.accessToken;

  const refreshed = await refreshAccessToken(account.refreshToken);
  const tokenExpiresAt = new Date(
    Date.now() + refreshed.expiresIn * 1000,
  ).toISOString();
  if (persist) {
    await persist({
      accessToken: refreshed.accessToken,
      tokenExpiresAt,
    });
  }
  return refreshed.accessToken;
}

export type DiscoveredYouTubeChannel = {
  channelId: string;
  channelTitle: string;
  thumbnailUrl?: string | null;
};

export async function discoverYouTubeChannels(
  accessToken: string,
): Promise<DiscoveredYouTubeChannel[]> {
  const params = new URLSearchParams({
    part: "snippet,contentDetails",
    mine: "true",
  });
  const res = await fetch(`${YT_API}/channels?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as {
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        thumbnails?: { default?: { url?: string } };
      };
    }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || "Failed to load YouTube channels.");
  }
  return (json.items ?? [])
    .filter((item) => item.id)
    .map((item) => ({
      channelId: item.id!,
      channelTitle: item.snippet?.title || "YouTube channel",
      thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? null,
    }));
}

export function formatYouTubeTitle(title: string): string {
  const trimmed = title.trim() || "Hookr Short";
  if (/#shorts/i.test(trimmed)) return trimmed.slice(0, 100);
  const withTag = `${trimmed} #Shorts`;
  return withTag.length <= 100 ? withTag : trimmed.slice(0, 100);
}

export function formatYouTubeDescription(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return "#Shorts";
  if (/#shorts/i.test(trimmed)) return trimmed.slice(0, 5000);
  return `${trimmed}\n\n#Shorts`.slice(0, 5000);
}

export function isYouTubeQuotaError(message: string): boolean {
  return /quota|dailyLimitExceeded|uploadLimitExceeded/i.test(message);
}

export async function getYouTubeVideoStatus(
  accessToken: string,
  videoId: string,
): Promise<{ privacyStatus?: string; uploadStatus?: string }> {
  const params = new URLSearchParams({
    part: "status",
    id: videoId,
  });
  const res = await fetch(`${YT_API}/videos?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as {
    items?: Array<{
      status?: { privacyStatus?: string; uploadStatus?: string };
    }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || "Failed to read YouTube video status.");
  }
  return json.items?.[0]?.status ?? {};
}

export async function uploadYouTubeVideo(options: {
  accessToken: string;
  videoPath: string;
  title: string;
  description: string;
  publishAt?: string | null;
  publishNow?: boolean;
}): Promise<{ videoId: string }> {
  const fileStat = await stat(options.videoPath);
  const title = formatYouTubeTitle(options.title);
  const description = formatYouTubeDescription(options.description);
  const publishNow = Boolean(options.publishNow);
  const publishAt =
    !publishNow && options.publishAt
      ? new Date(options.publishAt).toISOString()
      : null;

  const status: Record<string, string | boolean> = publishNow
    ? { privacyStatus: "public", selfDeclaredMadeForKids: false }
    : {
        privacyStatus: "private",
        selfDeclaredMadeForKids: false,
        ...(publishAt ? { publishAt } : {}),
      };

  const initRes = await fetch(
    `${YT_UPLOAD}?uploadType=resumable&part=snippet,status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(fileStat.size),
      },
      body: JSON.stringify({
        snippet: {
          title,
          description,
          categoryId: "22",
        },
        status,
      }),
    },
  );

  if (!initRes.ok) {
    const err = (await initRes.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(err.error?.message || "YouTube upload init failed.");
  }

  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) {
    throw new Error("YouTube upload URL missing from response.");
  }

  const buffer = await readFile(options.videoPath);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(buffer.byteLength),
      "Content-Type": "video/mp4",
    },
    body: buffer,
  });

  const uploadJson = (await uploadRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!uploadRes.ok || !uploadJson.id) {
    throw new Error(uploadJson.error?.message || "YouTube upload failed.");
  }

  return { videoId: uploadJson.id };
}
