import { timingSafeEqual } from "crypto";

export {
  CAMPAIGN_COOKIE,
  SESSION_COOKIE,
  campaignCookieOptions,
  clearSessionCookieOptions,
  createSessionToken,
  isSecureRequest,
  sessionCookieOptions,
  verifySessionToken,
} from "@/lib/auth-session";

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
