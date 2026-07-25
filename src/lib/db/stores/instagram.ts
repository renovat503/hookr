import { desc, eq } from "drizzle-orm";
import { getAccountLastPublishedAt, normalizeAutoPostIntervalHours } from "@/lib/instagram-autopost";
import { isInstagramRateLimitError } from "@/lib/instagram-errors";
import { normalizePostingGoal } from "@/lib/posting-slots";
import { getDb } from "@/lib/db/client";
import {
  instagramAccounts as instagramAccountsTable,
  instagramMeta as instagramMetaTable,
  scheduledPosts as scheduledPostsTable,
} from "@/lib/db/schema";
import type {
  AccountPostingGoal,
  InstagramAccount,
  InstagramData,
  ScheduledPost,
  ScheduledPostSource,
} from "@/lib/types";

const META_ID = "default";

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

function rowToAccount(
  row: typeof instagramAccountsTable.$inferSelect,
): InstagramAccount {
  return {
    id: row.id,
    igUserId: row.igUserId,
    username: row.username,
    profilePictureUrl: row.profilePictureUrl,
    pageId: row.pageId,
    pageName: row.pageName,
    accessToken: row.accessToken,
    connectedAt: row.connectedAt,
    tokenExpiresAt: row.tokenExpiresAt,
  };
}

function rowToScheduledPost(
  row: typeof scheduledPostsTable.$inferSelect,
): ScheduledPost {
  return {
    id: row.id,
    accountId: row.accountId,
    exportId: row.exportId,
    exportName: row.exportName ?? undefined,
    caption: row.caption,
    scheduledAt: row.scheduledAt,
    status: row.status as ScheduledPost["status"],
    source: (row.source as ScheduledPostSource | null) ?? undefined,
    queuePosition: row.queuePosition ?? undefined,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
    publishedMediaId: row.publishedMediaId,
    error: row.error,
  };
}

async function readMetaRow() {
  try {
    const rows = await getDb()
      .select()
      .from(instagramMetaTable)
      .where(eq(instagramMetaTable.id, META_ID))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? err.cause.message
        : null;
    throw new Error(
      `instagram_meta query failed${cause ? `: ${cause}` : ""}: ${message}`,
    );
  }
}

async function ensureMetaRow() {
  const current = await readMetaRow();
  if (current) return current;
  await getDb().insert(instagramMetaTable).values({ id: META_ID });
  return (await readMetaRow())!;
}

export async function readInstagramPg(): Promise<InstagramData> {
  const db = getDb();
  const [accounts, posts, meta] = await Promise.all([
    db.select().from(instagramAccountsTable),
    db
      .select()
      .from(scheduledPostsTable)
      .orderBy(desc(scheduledPostsTable.createdAt)),
    ensureMetaRow(),
  ]);

  return normalize({
    accounts: accounts.map(rowToAccount),
    scheduledPosts: posts.map(rowToScheduledPost),
    publishedExportIds: meta.publishedExportIds ?? [],
    accountLastPublishedAt: meta.accountLastPublishedAt ?? {},
    autoPostEnabled: meta.autoPostEnabled,
    autoPostIntervalHours: normalizeAutoPostIntervalHours(
      meta.autoPostIntervalHours,
    ),
    accountPostingGoals: meta.accountPostingGoals ?? {},
    apiRateLimitedUntil: meta.apiRateLimitedUntil,
  });
}

async function writeInstagramPg(data: InstagramData): Promise<void> {
  const normalized = normalize(data);
  const db = getDb();

  await db.delete(scheduledPostsTable);
  await db.delete(instagramAccountsTable);

  if (normalized.accounts.length) {
    await db.insert(instagramAccountsTable).values(
      normalized.accounts.map((account) => ({
        id: account.id,
        igUserId: account.igUserId,
        username: account.username,
        profilePictureUrl: account.profilePictureUrl,
        pageId: account.pageId,
        pageName: account.pageName,
        accessToken: account.accessToken,
        connectedAt: account.connectedAt,
        tokenExpiresAt: account.tokenExpiresAt,
      })),
    );
  }

  if (normalized.scheduledPosts.length) {
    await db.insert(scheduledPostsTable).values(
      normalized.scheduledPosts.map((post) => ({
        id: post.id,
        accountId: post.accountId,
        exportId: post.exportId,
        exportName: post.exportName,
        caption: post.caption,
        scheduledAt: post.scheduledAt,
        status: post.status,
        source: post.source ?? "manual",
        queuePosition: post.queuePosition ?? null,
        createdAt: post.createdAt,
        publishedAt: post.publishedAt,
        publishedMediaId: post.publishedMediaId,
        error: post.error,
      })),
    );
  }

  await db
    .insert(instagramMetaTable)
    .values({
      id: META_ID,
      publishedExportIds: normalized.publishedExportIds,
      accountLastPublishedAt: normalized.accountLastPublishedAt,
      autoPostEnabled: normalized.autoPostEnabled,
      autoPostIntervalHours: normalized.autoPostIntervalHours,
      accountPostingGoals: normalized.accountPostingGoals ?? {},
      apiRateLimitedUntil: normalized.apiRateLimitedUntil,
    })
    .onConflictDoUpdate({
      target: instagramMetaTable.id,
      set: {
        publishedExportIds: normalized.publishedExportIds,
        accountLastPublishedAt: normalized.accountLastPublishedAt,
        autoPostEnabled: normalized.autoPostEnabled,
        autoPostIntervalHours: normalized.autoPostIntervalHours,
        accountPostingGoals: normalized.accountPostingGoals ?? {},
        apiRateLimitedUntil: normalized.apiRateLimitedUntil,
      },
    });
}

export async function upsertInstagramAccountsPg(
  accounts: InstagramAccount[],
): Promise<InstagramAccount[]> {
  const data = await readInstagramPg();
  for (const account of accounts) {
    const idx = data.accounts.findIndex((a) => a.igUserId === account.igUserId);
    if (idx >= 0) data.accounts[idx] = account;
    else data.accounts.unshift(account);
  }
  await writeInstagramPg(data);
  return data.accounts;
}

export async function removeInstagramAccountPg(id: string): Promise<void> {
  const data = await readInstagramPg();
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
  await writeInstagramPg(data);
}

export async function setAutoPostSettingsPg(patch: {
  enabled?: boolean;
  intervalHours?: number;
}) {
  const data = await readInstagramPg();
  if (typeof patch.enabled === "boolean") {
    data.autoPostEnabled = patch.enabled;
  }
  if (patch.intervalHours !== undefined) {
    data.autoPostIntervalHours = normalizeAutoPostIntervalHours(
      patch.intervalHours,
    );
  }
  await writeInstagramPg(data);
  return {
    autoPostEnabled: data.autoPostEnabled,
    autoPostIntervalHours: data.autoPostIntervalHours,
  };
}

export async function setAccountPostingGoalPg(
  accountId: string,
  goal: AccountPostingGoal,
) {
  const data = await readInstagramPg();
  data.accountPostingGoals = {
    ...(data.accountPostingGoals ?? {}),
    [accountId]: normalizePostingGoal(goal),
  };
  await writeInstagramPg(data);
  return data.accountPostingGoals[accountId];
}

export async function setApiRateLimitedUntilPg(until: string | null) {
  const data = await readInstagramPg();
  data.apiRateLimitedUntil = until;
  await writeInstagramPg(data);
  return until;
}

export async function clearApiRateLimitIfExpiredPg(now = Date.now()) {
  const data = await readInstagramPg();
  if (
    data.apiRateLimitedUntil &&
    new Date(data.apiRateLimitedUntil).getTime() <= now
  ) {
    data.apiRateLimitedUntil = null;
    await writeInstagramPg(data);
  }
  return data;
}

export async function recordAccountPublishedPg(
  accountId: string,
  publishedAt: string,
) {
  const data = await readInstagramPg();
  const prev = data.accountLastPublishedAt[accountId];
  if (!prev || publishedAt > prev) {
    data.accountLastPublishedAt[accountId] = publishedAt;
    await writeInstagramPg(data);
  }
}

export async function addScheduledPostPg(post: ScheduledPost) {
  const data = await readInstagramPg();
  data.scheduledPosts.unshift(post);
  await writeInstagramPg(data);
  return post;
}

export async function updateScheduledPostPg(
  id: string,
  patch: Partial<ScheduledPost>,
) {
  const data = await readInstagramPg();
  const idx = data.scheduledPosts.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  data.scheduledPosts[idx] = { ...data.scheduledPosts[idx], ...patch };
  await writeInstagramPg(data);
  return data.scheduledPosts[idx];
}

export async function markExportPublishedOnAccountPg(
  accountId: string,
  exportId: string,
) {
  const data = await readInstagramPg();
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
  await writeInstagramPg(data);
  return data;
}

export async function markExportPublishedPg(exportId: string) {
  const data = await readInstagramPg();
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
  await writeInstagramPg(data);
  return data;
}

export async function removeScheduledPostPg(id: string) {
  const data = await readInstagramPg();
  data.scheduledPosts = data.scheduledPosts.filter((p) => p.id !== id);
  await writeInstagramPg(data);
}

export async function removeExportReferencesPg(exportId: string) {
  const data = await readInstagramPg();
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
  await writeInstagramPg(data);
}

export async function purgeExportFromInstagramPg(exportId: string) {
  const data = await readInstagramPg();
  data.publishedExportIds = data.publishedExportIds.filter((id) => id !== exportId);
  data.scheduledPosts = data.scheduledPosts.filter(
    (post) => post.exportId !== exportId,
  );
  await writeInstagramPg(data);
}

export async function writeInstagramStatePg(data: InstagramData): Promise<void> {
  await writeInstagramPg(data);
}
