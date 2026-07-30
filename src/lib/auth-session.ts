const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = "hookr_session";
export const CAMPAIGN_COOKIE = "hookr_campaign";
export const IG_OAUTH_CAMPAIGN_COOKIE = "ig_oauth_campaign";
export const YT_OAUTH_CAMPAIGN_COOKIE = "yt_oauth_campaign";

type SessionPayload = {
  exp: number;
};

function getSecret(): string {
  const secret = process.env.HOOKR_AUTH_SECRET?.trim();
  if (secret) return secret;
  return process.env.HOOKR_PASSWORD?.trim() ?? "";
}

function encodeBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64url");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64url"));
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function sign(body: string): Promise<string> {
  const secret = getSecret();
  if (!secret) throw new Error("Missing auth secret.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

export async function createSessionToken(): Promise<string> {
  const payload: SessionPayload = {
    exp: Date.now() + SESSION_MS,
  };
  const body = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${body}.${await sign(body)}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token || !getSecret()) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;

  try {
    const expected = await sign(body);
    const a = decodeBase64Url(sig);
    const b = decodeBase64Url(expected);
    if (!timingSafeEqual(a, b)) return false;

    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(body)),
    ) as SessionPayload;
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() === "https";
  }
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_MS / 1000,
  };
}

export function clearSessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 0,
  };
}

export function campaignCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  };
}
