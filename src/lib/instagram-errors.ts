const RATE_LIMIT_MS = 15 * 60 * 1000;

export function isInstagramRateLimitError(message: string): boolean {
  return /application request limit|rate limit|too many calls|(#\s*)?4\s*\/\s*hour|(#\s*)?200\s*calls/i.test(
    message,
  );
}

export function formatInstagramError(message: string): string {
  if (isInstagramRateLimitError(message)) {
    return "Instagram rate limit reached. Auto-post will retry in about 15 minutes.";
  }
  return message;
}

export function getInstagramRateLimitBackoffMs(): number {
  return RATE_LIMIT_MS;
}

export function isInstagramRateLimited(
  rateLimitedUntil: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!rateLimitedUntil) return false;
  return new Date(rateLimitedUntil).getTime() > now;
}
