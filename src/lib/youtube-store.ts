import {
  usesPostgresRead,
  usesPostgresWrite,
} from "@/lib/config/storage-mode";
import {
  addYouTubeScheduledPostPg,
  addYouTubeScheduledPostsPg,
  getYouTubeAccountByIdPg,
  markYouTubeExportPublishedPg,
  purgeExportFromYouTubePg,
  readYouTubePg,
  readYouTubePgAll,
  recordYouTubeAccountPublishedPg,
  removeYouTubeAccountPg,
  removeYouTubeExportReferencesPg,
  removeYouTubeScheduledPostPg,
  setYouTubeAccountPostingGoalPg,
  setYouTubeQuotaExhaustedUntilPgAll,
  updateYouTubeAccountPg,
  updateYouTubeScheduledPostPg,
  upsertYouTubeAccountsPg,
} from "@/lib/db/stores/youtube";
import { normalizePostingGoal } from "./posting-slots";
import type {
  AccountPostingGoal,
  YouTubeAccount,
  YouTubeData,
  YouTubeScheduledPost,
} from "./types";

export async function readYouTube(
  campaignId?: string | null,
): Promise<YouTubeData> {
  if (!campaignId) {
    return {
      accounts: [],
      scheduledPosts: [],
      publishedExportIds: [],
      accountLastPublishedAt: {},
      accountPostingGoals: {},
      quotaExhaustedUntil: null,
    };
  }
  if (usesPostgresRead()) {
    return readYouTubePg(campaignId);
  }
  return {
    accounts: [],
    scheduledPosts: [],
    publishedExportIds: [],
    accountLastPublishedAt: {},
    accountPostingGoals: {},
    quotaExhaustedUntil: null,
  };
}

export async function readYouTubeAll(): Promise<YouTubeData> {
  if (usesPostgresRead()) {
    return readYouTubePgAll();
  }
  return {
    accounts: [],
    scheduledPosts: [],
    publishedExportIds: [],
    accountLastPublishedAt: {},
    accountPostingGoals: {},
    quotaExhaustedUntil: null,
  };
}

export async function upsertYouTubeAccounts(accounts: YouTubeAccount[]) {
  if (usesPostgresWrite()) {
    return upsertYouTubeAccountsPg(accounts);
  }
  return accounts;
}

export async function removeYouTubeAccount(id: string) {
  if (usesPostgresWrite()) {
    await removeYouTubeAccountPg(id);
  }
}

export async function setYouTubeAccountPostingGoal(
  accountId: string,
  goal: AccountPostingGoal,
) {
  const normalized = normalizePostingGoal(goal);
  if (usesPostgresWrite()) {
    return setYouTubeAccountPostingGoalPg(accountId, normalized);
  }
  return normalized;
}

export async function setYouTubeQuotaExhaustedUntil(until: string | null) {
  if (usesPostgresWrite()) {
    return setYouTubeQuotaExhaustedUntilPgAll(until);
  }
  return until;
}

export async function recordYouTubeAccountPublished(
  accountId: string,
  publishedAt: string,
) {
  if (usesPostgresWrite()) {
    await recordYouTubeAccountPublishedPg(accountId, publishedAt);
  }
}

export async function addYouTubeScheduledPost(post: YouTubeScheduledPost) {
  if (usesPostgresWrite()) {
    return addYouTubeScheduledPostPg(post);
  }
  return post;
}

export async function addYouTubeScheduledPosts(posts: YouTubeScheduledPost[]) {
  if (!posts.length) return posts;
  if (usesPostgresWrite()) {
    return addYouTubeScheduledPostsPg(posts);
  }
  return posts;
}

export async function updateYouTubeScheduledPost(
  id: string,
  patch: Partial<YouTubeScheduledPost>,
) {
  if (usesPostgresWrite()) {
    return updateYouTubeScheduledPostPg(id, patch);
  }
  return null;
}

export async function removeYouTubeScheduledPost(id: string) {
  if (usesPostgresWrite()) {
    await removeYouTubeScheduledPostPg(id);
  }
}

export async function purgeExportFromYouTube(exportId: string) {
  if (usesPostgresWrite()) {
    await purgeExportFromYouTubePg(exportId);
  }
}

export async function removeYouTubeExportReferences(exportId: string) {
  if (usesPostgresWrite()) {
    await removeYouTubeExportReferencesPg(exportId);
  }
}

export async function updateYouTubeAccountTokens(
  id: string,
  patch: Partial<Pick<YouTubeAccount, "accessToken" | "tokenExpiresAt" | "refreshToken">>,
) {
  if (usesPostgresWrite()) {
    await updateYouTubeAccountPg(id, patch);
  }
}

export async function getYouTubeAccountById(id: string) {
  if (usesPostgresRead()) {
    return getYouTubeAccountByIdPg(id);
  }
  return null;
}

export async function markYouTubeExportPublished(
  exportId: string,
  campaignId: string,
) {
  if (usesPostgresWrite()) {
    await markYouTubeExportPublishedPg(exportId, campaignId);
  }
}

export async function reorderYouTubeAccountQueue(
  accountId: string,
  orderedIds: string[],
  campaignId: string,
) {
  const data = await readYouTube(campaignId);
  const queue = data.scheduledPosts.filter(
    (post) =>
      post.accountId === accountId &&
      post.status === "queued" &&
      post.source === "queue",
  );
  const queueIds = new Set(queue.map((post) => post.id));
  if (
    orderedIds.length !== queue.length ||
    orderedIds.some((id) => !queueIds.has(id))
  ) {
    throw new Error("Invalid queue order.");
  }

  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index]!;
    await updateYouTubeScheduledPost(id, { queuePosition: index });
  }
}

export function publicYouTubeAccount(account: YouTubeAccount) {
  const {
    accessToken: _accessToken,
    refreshToken: _refreshToken,
    ...rest
  } = account;
  return rest;
}

export { isExportPublishedOnYouTubeAccount } from "./youtube-queue";
