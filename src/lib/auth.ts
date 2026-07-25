import { createHmac, timingSafeEqual } from "crypto";

const SESSION_COOKIE = "hookr_session";
const CAMPAIGN_COOKIE = "hookr_campaign";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export { SESSION_COOKIE, CAMPAIGN_COOKIE };

function getSecret(): string {
  const secret = process.env.HOOKR_AUTH_SECRET?.trim();
  if (secret) return secret;
  const fallback = process.env.HOOKR_PASSWORD?.trim();
  if (fallback) return fallback;
  throw new Error(
    "Set HOOKR_AUTH_SECRET or HOOKR_PASSWORD in .env.local for authentication.",
  );
}

export function getAppPassword(): string {
  const password = process.env.HOOKR_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      "Set HOOKR_PASSWORD in .env.local to enable login.",
    );
  }
  return password;
}

export function verifyPassword(input: string): boolean {
  const expected = getAppPassword();
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type SessionPayload = {
  exp: number;
};

function sign(body: string): string {
  return createHmac("sha256", getSecret()).update(body).digest("base64url");
}

export function createSessionToken(): string {
  const payload: SessionPayload = {
    exp: Date.now() + SESSION_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  try {
    const expected = sign(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    return payload.exp > Date.now();
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
