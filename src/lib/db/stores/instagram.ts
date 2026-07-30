import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { getAccountLastPublishedAt } from "@/lib/instagram-autopost";
import { isInstagramRateLimitError } from "@/lib/instagram-errors";
import { normalizePostingGoal } from "@/lib/posting-slots";
import { getDb } from "@/lib/db/client";
import { dbQuery } from "@/lib/db/query";
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

import {
  migrateLegacyInstagramOnce,
  repairInstagramCampaignScope,
} from "@/lib/db/stores/instagram-campaign";

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
    campaignId: row.campaignId,
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
    campaignId: row.campaignId,
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

function accountValues(account: InstagramAccount) {
  return {
    id: account.id,
    campaignId: account.campaignId ?? null,
    igUserId: account.igUserId,
    username: account.username,
    profilePictureUrl: account.profilePictureUrl,
    pageId: account.pageId,
    pageName: account.pageName,
    accessToken: account.accessToken,
    connectedAt: account.connectedAt,
    tokenExpiresAt: account.tokenExpiresAt,
  };
}

function scheduledPostValues(post: ScheduledPost) {
  return {
    id: post.id,
    campaignId: post.campaignId ?? null,
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
  };
}

function scheduledPostPatch(
  patch: Partial<ScheduledPost>,
): Partial<typeof scheduledPostsTable.$inferInsert> {
  const set: Partial<typeof scheduledPostsTable.$inferInsert> = {};
  if (patch.accountId !== undefined) set.accountId = patch.accountId;
  if (patch.campaignId !== undefined) set.campaignId = patch.campaignId;
  if (patch.exportId !== undefined) set.exportId = patch.exportId;
  if (patch.exportName !== undefined) set.exportName = patch.exportName;
  if (patch.caption !== undefined) set.caption = patch.caption;
  if (patch.scheduledAt !== undefined) set.scheduledAt = patch.scheduledAt;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.source !== undefined) set.source = patch.source;
  if (patch.queuePosition !== undefined) {
    set.queuePosition = patch.queuePosition ?? null;
  }
  if (patch.createdAt !== undefined) set.createdAt = patch.createdAt;
  if (patch.publishedAt !== undefined) set.publishedAt = patch.publishedAt;
  if (patch.publishedMediaId !== undefined) {
    set.publishedMediaId = patch.publishedMediaId;
  }
  if (patch.error !== undefined) set.error = patch.error;
  return set;
}

async function readMetaRow(campaignId: string) {
  try {
    const rows = await getDb()
      .select()
      .from(instagramMetaTable)
      .where(eq(instagramMetaTable.id, campaignId))
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

async function ensureMetaRow(campaignId: string) {
  const current = await readMetaRow(campaignId);
  if (current) return current;
  await getDb().insert(instagramMetaTable).values({ id: campaignId });
  return (await readMetaRow(campaignId))!;
}

async function patchMetaRow(
  campaignId: string,
  patch: Partial<{
    publishedExportIds: string[];
    accountLastPublishedAt: Record<string, string>;
    accountPostingGoals: Record<string, AccountPostingGoal>;
    apiRateLimitedUntil: string | null;
  }>,
) {
  await ensureMetaRow(campaignId);
  const set: Partial<typeof instagramMetaTable.$inferInsert> = {};
  if (patch.publishedExportIds !== undefined) {
    set.publishedExportIds = patch.publishedExportIds;
  }
  if (patch.accountLastPublishedAt !== undefined) {
    set.accountLastPublishedAt = patch.accountLastPublishedAt;
  }
  if (patch.accountPostingGoals !== undefined) {
    set.accountPostingGoals = patch.accountPostingGoals;
  }
  if (patch.apiRateLimitedUntil !== undefined) {
    set.apiRateLimitedUntil = patch.apiRateLimitedUntil;
  }
  if (Object.keys(set).length === 0) return;
  await getDb()
    .update(instagramMetaTable)
    .set(set)
    .where(eq(instagramMetaTable.id, campaignId));
}

async function accountCampaignId(accountId: string): Promise<string | null> {
  const rows = await getDb()
    .select({ campaignId: instagramAccountsTable.campaignId })
    .from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.id, accountId))
    .limit(1);
  return rows[0]?.campaignId ?? null;
}

const scheduledPostsBaseFilter = and(
  ne(scheduledPostsTable.source, "auto"),
  or(
    inArray(scheduledPostsTable.status, [
      "scheduled",
      "queued",
      "publishing",
      "failed",
    ]),
    and(
      eq(scheduledPostsTable.status, "published"),
      sql`${scheduledPostsTable.scheduledAt} >= now() - interval '90 days'`,
    ),
  ),
);

const scheduledPostsQuery = (campaignId?: string) => {
  const filters = campaignId
    ? and(eq(scheduledPostsTable.campaignId, campaignId), scheduledPostsBaseFilter)
    : scheduledPostsBaseFilter;
  return getDb()
    .select()
    .from(scheduledPostsTable)
    .where(filters)
    .orderBy(desc(scheduledPostsTable.createdAt));
};

function buildInstagramData(
  campaignId: string,
  accounts: InstagramAccount[],
  posts: ScheduledPost[],
  meta: Awaited<ReturnType<typeof ensureMetaRow>>,
): InstagramData {
  const accountIds = new Set(accounts.map((a) => a.id));
  const scopedPosts = posts.filter(
    (post) =>
      post.campaignId === campaignId && accountIds.has(post.accountId),
  );
  const scopedGoals = Object.fromEntries(
    Object.entries(meta.accountPostingGoals ?? {}).filter(([accountId]) =>
      accountIds.has(accountId),
    ),
  );
  const scopedLastPublished = Object.fromEntries(
    Object.entries(meta.accountLastPublishedAt ?? {}).filter(([accountId]) =>
      accountIds.has(accountId),
    ),
  );

  return normalize({
    accounts,
    scheduledPosts: scopedPosts,
    publishedExportIds: meta.publishedExportIds ?? [],
    accountLastPublishedAt: scopedLastPublished,
    accountPostingGoals: scopedGoals,
    apiRateLimitedUntil: meta.apiRateLimitedUntil,
  });
}

export async function readInstagramPg(
  campaignId: string,
): Promise<InstagramData> {
  await repairInstagramCampaignScope();
  const db = getDb();
  const accounts = await dbQuery(
    () =>
      db
        .select()
        .from(instagramAccountsTable)
        .where(eq(instagramAccountsTable.campaignId, campaignId)),
    "read instagram accounts",
  );
  const posts = await dbQuery(
    () => scheduledPostsQuery(campaignId),
    "read instagram scheduled posts",
  );
  const meta = await dbQuery(
    () => ensureMetaRow(campaignId),
    "read instagram meta",
  );

  return buildInstagramData(
    campaignId,
    accounts.map(rowToAccount),
    posts.map(rowToScheduledPost),
    meta,
  );
}

/** All campaigns — for publishing due posts across campaigns. */
export async function readInstagramPgAll(): Promise<InstagramData> {
  await repairInstagramCampaignScope();
  const db = getDb();
  const accounts = await dbQuery(
    () => db.select().from(instagramAccountsTable),
    "read instagram accounts",
  );
  const posts = await dbQuery(
    () => scheduledPostsQuery(),
    "read instagram scheduled posts",
  );
  const metaRows = await dbQuery(
    () => db.select().from(instagramMetaTable),
    "read instagram meta",
  );

  const mergedPublished = new Set<string>();
  const mergedLastPublished: Record<string, string> = {};
  const mergedGoals: Record<string, AccountPostingGoal> = {};
  let apiRateLimitedUntil: string | null = null;

  for (const meta of metaRows) {
    for (const id of meta.publishedExportIds ?? []) mergedPublished.add(id);
    Object.assign(mergedLastPublished, meta.accountLastPublishedAt ?? {});
    Object.assign(mergedGoals, meta.accountPostingGoals ?? {});
    if (meta.apiRateLimitedUntil) {
      apiRateLimitedUntil = meta.apiRateLimitedUntil;
    }
  }

  return normalize({
    accounts: accounts.map(rowToAccount),
    scheduledPosts: posts.map(rowToScheduledPost),
    publishedExportIds: [...mergedPublished],
    accountLastPublishedAt: mergedLastPublished,
    accountPostingGoals: mergedGoals,
    apiRateLimitedUntil,
  });
}

/** Full replace — only for migration / json sync tooling. */
async function writeInstagramPg(data: InstagramData): Promise<void> {
  const normalized = normalize(data);
  const db = getDb();

  await db.delete(scheduledPostsTable);
  await db.delete(instagramAccountsTable);

  if (normalized.accounts.length) {
    await db
      .insert(instagramAccountsTable)
      .values(normalized.accounts.map(accountValues));
  }

  if (normalized.scheduledPosts.length) {
    await db
      .insert(scheduledPostsTable)
      .values(normalized.scheduledPosts.map(scheduledPostValues));
  }

  const campaignIds = new Set(
    [
      ...normalized.accounts.map((a) => a.campaignId),
      ...normalized.scheduledPosts.map((p) => p.campaignId),
    ].filter((id): id is string => Boolean(id)),
  );

  for (const campaignId of campaignIds) {
    const accountIds = new Set(
      normalized.accounts
        .filter((a) => a.campaignId === campaignId)
        .map((a) => a.id),
    );
    await patchMetaRow(campaignId, {
      publishedExportIds: normalized.publishedExportIds,
      accountLastPublishedAt: Object.fromEntries(
        Object.entries(normalized.accountLastPublishedAt).filter(([id]) =>
          accountIds.has(id),
        ),
      ),
      accountPostingGoals: Object.fromEntries(
        Object.entries(normalized.accountPostingGoals ?? {}).filter(([id]) =>
          accountIds.has(id),
        ),
      ),
      apiRateLimitedUntil: normalized.apiRateLimitedUntil,
    });
  }
}

export async function upsertInstagramAccountsPg(
  accounts: InstagramAccount[],
): Promise<InstagramAccount[]> {
  const db = getDb();
  for (const account of accounts) {
    if (!account.campaignId) {
      throw new Error("campaignId is required when connecting Instagram.");
    }
    const existing = await db
      .select({ id: instagramAccountsTable.id })
      .from(instagramAccountsTable)
      .where(
        and(
          eq(instagramAccountsTable.igUserId, account.igUserId),
          eq(instagramAccountsTable.campaignId, account.campaignId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(instagramAccountsTable)
        .set(accountValues({ ...account, id: existing[0].id }))
        .where(eq(instagramAccountsTable.id, existing[0].id));
    } else {
      await db.insert(instagramAccountsTable).values(accountValues(account));
    }
  }

  const campaignId = accounts[0]?.campaignId;
  if (!campaignId) return accounts;
  const rows = await db
    .select()
    .from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.campaignId, campaignId));
  return rows.map(rowToAccount);
}

export async function removeInstagramAccountPg(id: string): Promise<void> {
  const campaignId = await accountCampaignId(id);
  const db = getDb();
  await db
    .delete(instagramAccountsTable)
    .where(eq(instagramAccountsTable.id, id));

  if (campaignId) {
    const meta = await ensureMetaRow(campaignId);
    const accountLastPublishedAt = { ...(meta.accountLastPublishedAt ?? {}) };
    delete accountLastPublishedAt[id];
    const accountPostingGoals = { ...(meta.accountPostingGoals ?? {}) };
    delete accountPostingGoals[id];
    await patchMetaRow(campaignId, {
      accountLastPublishedAt,
      accountPostingGoals,
    });
  }

  await db
    .update(scheduledPostsTable)
    .set({ status: "cancelled", error: "Account disconnected" })
    .where(
      and(
        eq(scheduledPostsTable.accountId, id),
        inArray(scheduledPostsTable.status, ["scheduled", "queued"]),
      ),
    );
}

export async function setAccountPostingGoalPg(
  accountId: string,
  goal: AccountPostingGoal,
) {
  const campaignId = await accountCampaignId(accountId);
  if (!campaignId) {
    throw new Error("Instagram account not found.");
  }
  const meta = await ensureMetaRow(campaignId);
  const accountPostingGoals = {
    ...(meta.accountPostingGoals ?? {}),
    [accountId]: normalizePostingGoal(goal),
  };
  await patchMetaRow(campaignId, { accountPostingGoals });
  return accountPostingGoals[accountId]!;
}

export async function setApiRateLimitedUntilPg(
  campaignId: string,
  until: string | null,
) {
  await patchMetaRow(campaignId, { apiRateLimitedUntil: until });
  return until;
}

export async function setApiRateLimitedUntilPgAll(until: string | null) {
  const rows = await getDb().select({ id: instagramMetaTable.id }).from(instagramMetaTable);
  for (const row of rows) {
    await patchMetaRow(row.id, { apiRateLimitedUntil: until });
  }
  return until;
}

export async function clearApiRateLimitIfExpiredPgAll(now = Date.now()) {
  const rows = await getDb().select().from(instagramMetaTable);
  let cleared = false;
  for (const meta of rows) {
    if (
      meta.apiRateLimitedUntil &&
      new Date(meta.apiRateLimitedUntil).getTime() <= now
    ) {
      await patchMetaRow(meta.id, { apiRateLimitedUntil: null });
      cleared = true;
    }
  }
  return cleared;
}

export async function recordAccountPublishedPg(
  accountId: string,
  publishedAt: string,
) {
  const campaignId = await accountCampaignId(accountId);
  if (!campaignId) return;
  const meta = await ensureMetaRow(campaignId);
  const prev = meta.accountLastPublishedAt?.[accountId];
  if (!prev || publishedAt > prev) {
    await patchMetaRow(campaignId, {
      accountLastPublishedAt: {
        ...(meta.accountLastPublishedAt ?? {}),
        [accountId]: publishedAt,
      },
    });
  }
}

export async function addScheduledPostPg(post: ScheduledPost) {
  await getDb().insert(scheduledPostsTable).values(scheduledPostValues(post));
  return post;
}

export async function addScheduledPostsPg(posts: ScheduledPost[]) {
  if (!posts.length) return posts;
  await getDb()
    .insert(scheduledPostsTable)
    .values(posts.map(scheduledPostValues));
  return posts;
}

export async function updateScheduledPostPg(
  id: string,
  patch: Partial<ScheduledPost>,
) {
  const set = scheduledPostPatch(patch);
  if (Object.keys(set).length === 0) {
    const rows = await getDb()
      .select()
      .from(scheduledPostsTable)
      .where(eq(scheduledPostsTable.id, id))
      .limit(1);
    return rows[0] ? rowToScheduledPost(rows[0]) : null;
  }

  const rows = await getDb()
    .update(scheduledPostsTable)
    .set(set)
    .where(eq(scheduledPostsTable.id, id))
    .returning();
  return rows[0] ? rowToScheduledPost(rows[0]) : null;
}

export async function markExportPublishedOnAccountPg(
  accountId: string,
  exportId: string,
) {
  const campaignId = await accountCampaignId(accountId);
  if (!campaignId) return readInstagramPgAll();
  const meta = await ensureMetaRow(campaignId);
  const publishedExportIds = meta.publishedExportIds ?? [];
  if (!publishedExportIds.includes(exportId)) {
    await patchMetaRow(campaignId, {
      publishedExportIds: [...publishedExportIds, exportId],
    });
  }

  await getDb()
    .update(scheduledPostsTable)
    .set({
      status: "cancelled",
      error: "Video already published on this account",
    })
    .where(
      and(
        eq(scheduledPostsTable.accountId, accountId),
        eq(scheduledPostsTable.exportId, exportId),
        inArray(scheduledPostsTable.status, ["queued", "scheduled", "failed"]),
      ),
    );

  return readInstagramPg(campaignId);
}

export async function markExportPublishedPg(
  exportId: string,
  campaignId?: string | null,
) {
  if (campaignId) {
    const meta = await ensureMetaRow(campaignId);
    const publishedExportIds = meta.publishedExportIds ?? [];
    if (!publishedExportIds.includes(exportId)) {
      await patchMetaRow(campaignId, {
        publishedExportIds: [...publishedExportIds, exportId],
      });
    }
  } else {
    const rows = await getDb()
      .select({ campaignId: scheduledPostsTable.campaignId })
      .from(scheduledPostsTable)
      .where(eq(scheduledPostsTable.exportId, exportId))
      .limit(1);
    const inferred = rows[0]?.campaignId;
    if (inferred) {
      await markExportPublishedPg(exportId, inferred);
    }
  }

  await getDb()
    .update(scheduledPostsTable)
    .set({ status: "cancelled", error: "Video already published" })
    .where(
      and(
        eq(scheduledPostsTable.exportId, exportId),
        inArray(scheduledPostsTable.status, ["scheduled", "failed"]),
      ),
    );

  return campaignId ? readInstagramPg(campaignId) : readInstagramPgAll();
}

async function purgeExportMetaForAllCampaigns(exportId: string) {
  const metaRows = await getDb().select().from(instagramMetaTable);
  for (const meta of metaRows) {
    const publishedExportIds = (meta.publishedExportIds ?? []).filter(
      (id) => id !== exportId,
    );
    if (publishedExportIds.length !== (meta.publishedExportIds ?? []).length) {
      await patchMetaRow(meta.id, { publishedExportIds });
    }
  }
}

export async function removeExportReferencesPg(exportId: string) {
  await purgeExportMetaForAllCampaigns(exportId);

  await getDb()
    .update(scheduledPostsTable)
    .set({ status: "cancelled", error: "Video deleted" })
    .where(
      and(
        eq(scheduledPostsTable.exportId, exportId),
        inArray(scheduledPostsTable.status, [
          "queued",
          "scheduled",
          "failed",
          "publishing",
        ]),
      ),
    );
}

export async function purgeExportFromInstagramPg(exportId: string) {
  await purgeExportMetaForAllCampaigns(exportId);
  await getDb()
    .delete(scheduledPostsTable)
    .where(eq(scheduledPostsTable.exportId, exportId));
}

export async function removeScheduledPostPg(id: string) {
  await getDb()
    .delete(scheduledPostsTable)
    .where(eq(scheduledPostsTable.id, id));
}

export async function writeInstagramStatePg(data: InstagramData): Promise<void> {
  await writeInstagramPg(data);
}
