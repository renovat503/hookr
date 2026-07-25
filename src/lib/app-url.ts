/**
 * Resolve the public app origin for OAuth redirects and absolute URLs.
 * Prefers the incoming request (Railway / reverse-proxy headers) over APP_URL
 * so a stale env var cannot break Instagram OAuth.
 */
export function resolveAppUrl(request?: Request): string {
  const fromRequest = request ? appUrlFromRequest(request) : null;
  if (fromRequest) return fromRequest;

  return (
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

function appUrlFromRequest(request: Request): string | null {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (forwardedHost) {
    const host = forwardedHost.split(",")[0]?.trim();
    const proto = (forwardedProto?.split(",")[0]?.trim() || "https").replace(
      /:$/,
      "",
    );
    if (host) {
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }

  try {
    const url = new URL(request.url);
    if (url.hostname && url.hostname !== "0.0.0.0") {
      return `${url.protocol}//${url.host}`.replace(/\/$/, "");
    }
  } catch {
    // ignore
  }

  return null;
}

export function instagramRedirectUri(appUrl: string) {
  return `${appUrl.replace(/\/$/, "")}/api/instagram/callback`;
}
