import type { InstagramData } from "./types";

/** Last successful publish time for an account (from meta or published posts). */
export function getAccountLastPublishedAt(
  data: InstagramData,
  accountId: string,
): string | null {
  const stored = data.accountLastPublishedAt?.[accountId];
  if (stored) return stored;

  let latest: string | null = null;
  for (const post of data.scheduledPosts) {
    if (post.accountId !== accountId || post.status !== "published") continue;
    if (!post.publishedAt) continue;
    if (!latest || post.publishedAt > latest) latest = post.publishedAt;
  }
  return latest;
}
