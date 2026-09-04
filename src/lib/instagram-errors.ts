const RATE_LIMIT_MS = 15 * 60 * 1000;

/** Instagram rejects captions with more than 30 hashtags (often as "caption was too long"). */
export const INSTAGRAM_MAX_HASHTAGS = 30;

export function countInstagramHashtags(caption: string): number {
  return (caption.match(/#\w+/g) ?? []).length;
}

/** Keep the first N hashtags; drop extras so publish does not fail. */
export function limitInstagramHashtags(
  caption: string,
  max = INSTAGRAM_MAX_HASHTAGS,
): string {
  const matches = [...caption.matchAll(/#\w+/g)];
  if (matches.length <= max) return caption;

  let out = caption;
  for (let i = matches.length - 1; i >= max; i -= 1) {
    const match = matches[i];
    if (match.index === undefined) continue;
    let start = match.index;
    const end = start + match[0].length;
    if (start > 0 && /\s/.test(out[start - 1] ?? "")) start -= 1;
    out = `${out.slice(0, start)}${out.slice(end)}`;
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function isInstagramRateLimitError(message: string): boolean {
  return /application request limit|rate limit|too many calls|(#\s*)?4\s*\/\s*hour|(#\s*)?200\s*calls/i.test(
    message,
  );
}

export function formatInstagramError(message: string): string {
  if (isInstagramRateLimitError(message)) {
    return "Instagram rate limit reached. Auto-post will retry in about 15 minutes.";
  }
  if (/caption was too long/i.test(message)) {
    return "Instagram rejected the caption (often too many hashtags — max 30).";
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
