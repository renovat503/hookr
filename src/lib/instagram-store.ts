import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import {
  usesJsonWrite,
  usesPostgresRead,
  usesPostgresWrite,
} from "@/lib/config/storage-mode";
import {
  addScheduledPostPg,
  clearApiRateLimitIfExpiredPg,
  markExportPublishedPg,
  markExportPublishedOnAccountPg,
  readInstagramPg,
  recordAccountPublishedPg,
  removeExportReferencesPg,
  purgeExportFromInstagramPg,
  removeInstagramAccountPg,
  removeScheduledPostPg,
  setApiRateLimitedUntilPg,
  setAutoPostSettingsPg,
  setAccountPostingGoalPg,
  updateScheduledPostPg,
  upsertInstagramAccountsPg,
  writeInstagramStatePg,
} from "@/lib/db/stores/instagram";
import { getAccountLastPublishedAt, normalizeAutoPostIntervalHours } from "./instagram-autopost";
import { isInstagramRateLimitError } from "./instagram-errors";
import {
  getAccountQueuePosts,
  isExportPublishedOnAccount,
  nextQueuePosition,
} from "./instagram-queue";
import { normalizePostingGoal } from "./posting-slots";
import type {
  AccountPostingGoal,
  InstagramAccount,
  InstagramData,
  ScheduledPost,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const MANIFEST_PATH = path.join(DATA_DIR, "instagram.json");

function normalize(data: Partial<InstagramData>): InstagramData {
  const published = new Set(data.publishedExportIds ?? []);
  for (const post of data.scheduledPosts ?? []) {
    if (post.status === "published") published.add(post.exportId);
  }

  const accountLastPublishedAt = { ...(data.accountLastPublishedAt ?? {}) };
  for (const account of data.accounts ?? []) {
    const fromPosts = getAccountLastPublishedAt(
      {
        accounts: data.accounts ?? [],
        scheduledPosts: data.scheduledPosts ?? [],
        publishedExportIds: [...published],
        accountLastPublishedAt,
        autoPostEnabled: data.autoPostEnabled ?? true,
        autoPostIntervalHours: normalizeAutoPostIntervalHours(
          data.autoPostIntervalHours,
        ),
      },
      account.id,
    );
    if (fromPosts && !accountLastPublishedAt[account.id]) {
      accountLastPublishedAt[account.id] = fromPosts;
    }
  }

  return {
    accounts: data.accounts ?? [],
    scheduledPosts: (data.scheduledPosts ?? []).filter(
      (post) =>
        !(
          post.id.startsWith("auto-") &&
          post.status === "failed" &&
          isInstagramRateLimitError(post.error ?? "")
        ),
    ),
    publishedExportIds: [...published],
    accountLastPublishedAt,
    autoPostEnabled: data.autoPostEnabled ?? true,
    autoPostIntervalHours: normalizeAutoPostIntervalHours(
      data.autoPostIntervalHours,
    ),
    accountPostingGoals: Object.fromEntries(
      Object.entries(data.accountPostingGoals ?? {}).map(([accountId, goal]) => [
        accountId,
        normalizePostingGoal(goal),
      ]),
    ),
    apiRateLimitedUntil: data.apiRateLimitedUntil ?? null,
  };
}

async function readInstagramJson(): Promise<InstagramData> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<InstagramData>;
    return normalize(parsed);
  } catch {
    return normalize({});
  }
}

async function writeInstagramJson(data: InstagramData) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(normalize(data), null, 2));
}

async function syncInstagram(data: InstagramData) {
  const normalized = normalize(data);
  if (usesJsonWrite()) {
    await writeInstagramJson(normalized);
  }
  if (usesPostgresWrite()) {
    await writeInstagramStatePg(normalized);
  }
  return normalized;
}

export async function readInstagram(): Promise<InstagramData> {
  if (usesPostgresRead()) {
    try {
      return await readInstagramPg();
    } catch (err) {
      console.error("[instagram] postgres read failed, falling back to json", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  return readInstagramJson();
}

export function isExportPublished(
  data: InstagramData,
  exportId: string,
): boolean {
  return data.publishedExportIds.includes(exportId);
}

export { isExportPublishedOnAccount } from "./instagram-queue";

export async function upsertInstagramAccounts(accounts: InstagramAccount[]) {
  if (usesPostgresWrite()) {
    try {
      return await upsertInstagramAccountsPg(accounts);
    } catch (err) {
      console.error("[instagram] postgres upsert accounts failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }

  const data = await readInstagramJson();
  for (const account of accounts) {
    const idx = data.accounts.findIndex((a) => a.igUserId === account.igUserId);
    if (idx >= 0) data.accounts[idx] = account;
    else data.accounts.unshift(account);
  }
  await syncInstagram(data);
  return data.accounts;
}

export async function removeInstagramAccount(id: string) {
  if (usesPostgresWrite()) {
    try {
      await removeInstagramAccountPg(id);
    } catch (err) {
      console.error("[instagram] postgres remove account failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    const data = await readInstagramJson();
    data.accounts = data.accounts.filter((a) => a.id !== id);
    delete data.accountLastPublishedAt[id];
    data.scheduledPosts = data.scheduledPosts.map((post) =>
      post.accountId === id &&
      (post.status === "scheduled" || post.status === "queued")
        ? {
            ...post,
            status: "cancelled" as const,
            error: "Account disconnected",
          }
        : post,
    );
    await writeInstagramJson(data);
  }
}

export async function setAutoPostSettings(patch: {
  enabled?: boolean;
  intervalHours?: number;
}) {
  if (usesPostgresWrite()) {
    try {
      return await setAutoPostSettingsPg(patch);
    } catch (err) {
      console.error("[instagram] postgres auto-post settings failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }

  const data = await readInstagramJson();
  if (typeof patch.enabled === "boolean") {
    data.autoPostEnabled = patch.enabled;
  }
  if (patch.intervalHours !== undefined) {
    data.autoPostIntervalHours = normalizeAutoPostIntervalHours(
      patch.intervalHours,
    );
  }
  await syncInstagram(data);
  return {
    autoPostEnabled: data.autoPostEnabled,
    autoPostIntervalHours: data.autoPostIntervalHours,
  };
}

export async function setAutoPostEnabled(enabled: boolean) {
  return setAutoPostSettings({ enabled });
}

export async function setAccountPostingGoal(
  accountId: string,
  goal: AccountPostingGoal,
) {
  const normalized = normalizePostingGoal(goal);
  if (usesPostgresWrite()) {
    try {
      return await setAccountPostingGoalPg(accountId, normalized);
    } catch (err) {
      console.error("[instagram] postgres posting goal failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }

  const data = await readInstagramJson();
  data.accountPostingGoals = {
    ...(data.accountPostingGoals ?? {}),
    [accountId]: normalized,
  };
  await syncInstagram(data);
  return normalized;
}

export async function setApiRateLimitedUntil(until: string | null) {
  if (usesPostgresWrite()) {
    try {
      return await setApiRateLimitedUntilPg(until);
    } catch (err) {
      console.error("[instagram] postgres rate limit failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  const data = await readInstagramJson();
  data.apiRateLimitedUntil = until;
  await syncInstagram(data);
  return until;
}

export async function clearApiRateLimitIfExpired(now = Date.now()) {
  if (usesPostgresWrite()) {
    try {
      return await clearApiRateLimitIfExpiredPg(now);
    } catch (err) {
      console.error("[instagram] postgres clear rate limit failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  const data = await readInstagramJson();
  if (
    data.apiRateLimitedUntil &&
    new Date(data.apiRateLimitedUntil).getTime() <= now
  ) {
    data.apiRateLimitedUntil = null;
    await syncInstagram(data);
  }
  return data;
}

export async function recordAccountPublished(
  accountId: string,
  publishedAt: string,
) {
  if (usesPostgresWrite()) {
    try {
      await recordAccountPublishedPg(accountId, publishedAt);
      return;
    } catch (err) {
      console.error("[instagram] postgres record publish failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  const data = await readInstagramJson();
  const prev = data.accountLastPublishedAt[accountId];
  if (!prev || publishedAt > prev) {
    data.accountLastPublishedAt[accountId] = publishedAt;
    await syncInstagram(data);
  }
}

export async function addScheduledPost(post: ScheduledPost) {
  if (usesPostgresWrite()) {
    try {
      return await addScheduledPostPg(post);
    } catch (err) {
      console.error("[instagram] postgres add schedule failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  const data = await readInstagramJson();
  data.scheduledPosts.unshift(post);
  await syncInstagram(data);
  return post;
}

export async function updateScheduledPost(
  id: string,
  patch: Partial<ScheduledPost>,
) {
  if (usesPostgresWrite()) {
    try {
      const updated = await updateScheduledPostPg(id, patch);
      if (updated) return updated;
    } catch (err) {
      console.error("[instagram] postgres update schedule failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  const data = await readInstagramJson();
  const idx = data.scheduledPosts.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  data.scheduledPosts[idx] = { ...data.scheduledPosts[idx], ...patch };
  await syncInstagram(data);
  return data.scheduledPosts[idx];
}

export async function reorderAccountQueue(
  accountId: string,
  orderedIds: string[],
) {
  const data = await readInstagram();
  const queue = getAccountQueuePosts(data, accountId);
  const queueIds = new Set(queue.map((post) => post.id));
  if (
    orderedIds.length !== queue.length ||
    orderedIds.some((id) => !queueIds.has(id))
  ) {
    throw new Error("Invalid queue order.");
  }

  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index];
    await updateScheduledPost(id, { queuePosition: index });
  }
}

export async function markExportPublishedOnAccount(
  accountId: string,
  exportId: string,
) {
  if (usesPostgresWrite()) {
    try {
      return await markExportPublishedOnAccountPg(accountId, exportId);
    } catch (err) {
      console.error("[instagram] postgres mark published failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  const data = await readInstagramJson();
  if (!data.publishedExportIds.includes(exportId)) {
    data.publishedExportIds.push(exportId);
  }
  data.scheduledPosts = data.scheduledPosts.map((post) => {
    if (
      post.accountId === accountId &&
      post.exportId === exportId &&
      (post.status === "queued" ||
        post.status === "scheduled" ||
        post.status === "failed")
    ) {
      return {
        ...post,
        status: "cancelled" as const,
        error: "Video already published on this account",
      };
    }
    return post;
  });
  await syncInstagram(data);
  return data;
}

export async function markExportPublished(exportId: string) {
  if (usesPostgresWrite()) {
    try {
      return await markExportPublishedPg(exportId);
    } catch (err) {
      console.error("[instagram] postgres mark published failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  const data = await readInstagramJson();
  if (!data.publishedExportIds.includes(exportId)) {
    data.publishedExportIds.push(exportId);
  }
  data.scheduledPosts = data.scheduledPosts.map((post) => {
    if (
      post.exportId === exportId &&
      (post.status === "scheduled" || post.status === "failed")
    ) {
      return {
        ...post,
        status: "cancelled" as const,
        error: "Video already published",
      };
    }
    return post;
  });
  await syncInstagram(data);
  return data;
}

export async function removeScheduledPost(id: string) {
  if (usesPostgresWrite()) {
    try {
      await removeScheduledPostPg(id);
    } catch (err) {
      console.error("[instagram] postgres remove schedule failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    const data = await readInstagramJson();
    data.scheduledPosts = data.scheduledPosts.filter((p) => p.id !== id);
    await writeInstagramJson(data);
  }
}

export async function removeExportReferences(exportId: string) {
  if (usesPostgresWrite()) {
    try {
      await removeExportReferencesPg(exportId);
    } catch (err) {
      console.error("[instagram] postgres remove export refs failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    const data = await readInstagramJson();
    data.publishedExportIds = data.publishedExportIds.filter((id) => id !== exportId);
    data.scheduledPosts = data.scheduledPosts.map((post) => {
      if (post.exportId !== exportId) return post;
      if (post.status === "published") return post;
      return {
        ...post,
        status: "cancelled" as const,
        error: "Video deleted",
      };
    });
    await writeInstagramJson(data);
  }
}

/** Drop all Instagram records for an export (including published history). */
export async function purgeExportFromInstagram(exportId: string) {
  if (usesPostgresWrite()) {
    try {
      await purgeExportFromInstagramPg(exportId);
    } catch (err) {
      console.error("[instagram] postgres purge export failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    const data = await readInstagramJson();
    data.publishedExportIds = data.publishedExportIds.filter((id) => id !== exportId);
    data.scheduledPosts = data.scheduledPosts.filter(
      (post) => post.exportId !== exportId,
    );
    await writeInstagramJson(data);
  }
}

/** Safe for client responses — strips access tokens */
export function publicInstagramAccount(account: InstagramAccount) {
  const { accessToken: _token, ...rest } = account;
  return rest;
}

/** Bulk replace instagram state — used by migration tooling. */
export async function replaceAllInstagram(data: InstagramData): Promise<void> {
  await syncInstagram(data);
}
