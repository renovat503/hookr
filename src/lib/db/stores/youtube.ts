import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { normalizePostingGoal } from "@/lib/posting-slots";
import { getDb } from "@/lib/db/client";
import { dbQuery } from "@/lib/db/query";
import {
  youtubeAccounts as youtubeAccountsTable,
  youtubeMeta as youtubeMetaTable,
  youtubeScheduledPosts as youtubeScheduledPostsTable,
} from "@/lib/db/schema";
import type {
  AccountPostingGoal,
  YouTubeAccount,
  YouTubeData,
  YouTubeScheduledPost,
  ScheduledPostSource,
} from "@/lib/types";

function normalize(data: Partial<YouTubeData>): YouTubeData {
  const published = new Set(data.publishedExportIds ?? []);
  for (const post of data.scheduledPosts ?? []) {
    if (post.status === "published") published.add(post.exportId);
  }

  return {
    accounts: data.accounts ?? [],
    scheduledPosts: data.scheduledPosts ?? [],
    publishedExportIds: [...published],
    accountLastPublishedAt: data.accountLastPublishedAt ?? {},
    accountPostingGoals: Object.fromEntries(
      Object.entries(data.accountPostingGoals ?? {}).map(([accountId, goal]) => [
        accountId,
        normalizePostingGoal(goal),
      ]),
    ),
    quotaExhaustedUntil: data.quotaExhaustedUntil ?? null,
  };
}

function rowToAccount(
  row: typeof youtubeAccountsTable.$inferSelect,
): YouTubeAccount {
  return {
    id: row.id,
    campaignId: row.campaignId,
    channelId: row.channelId,
    channelTitle: row.channelTitle,
    thumbnailUrl: row.thumbnailUrl,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    connectedAt: row.connectedAt,
    tokenExpiresAt: row.tokenExpiresAt,
  };
}

function rowToScheduledPost(
  row: typeof youtubeScheduledPostsTable.$inferSelect,
): YouTubeScheduledPost {
  return {
    id: row.id,
    campaignId: row.campaignId,
    accountId: row.accountId,
    exportId: row.exportId,
    exportName: row.exportName ?? undefined,
    title: row.title,
    description: row.description,
    scheduledAt: row.scheduledAt,
    status: row.status as YouTubeScheduledPost["status"],
    source: (row.source as ScheduledPostSource | null) ?? undefined,
    queuePosition: row.queuePosition ?? undefined,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
    youtubeVideoId: row.youtubeVideoId,
    error: row.error,
  };
}

function accountValues(account: YouTubeAccount) {
  return {
    id: account.id,
    campaignId: account.campaignId ?? null,
    channelId: account.channelId,
    channelTitle: account.channelTitle,
    thumbnailUrl: account.thumbnailUrl,
    accessToken: account.accessToken,
    refreshToken: account.refreshToken ?? null,
    connectedAt: account.connectedAt,
    tokenExpiresAt: account.tokenExpiresAt,
  };
}

function scheduledPostValues(post: YouTubeScheduledPost) {
  return {
    id: post.id,
    campaignId: post.campaignId ?? null,
    accountId: post.accountId,
    exportId: post.exportId,
    exportName: post.exportName,
    title: post.title,
    description: post.description,
    scheduledAt: post.scheduledAt,
    status: post.status,
    source: post.source ?? "manual",
    queuePosition: post.queuePosition ?? null,
    createdAt: post.createdAt,
    publishedAt: post.publishedAt,
    youtubeVideoId: post.youtubeVideoId ?? null,
    error: post.error,
  };
}

function scheduledPostPatch(
  patch: Partial<YouTubeScheduledPost>,
): Partial<typeof youtubeScheduledPostsTable.$inferInsert> {
  const set: Partial<typeof youtubeScheduledPostsTable.$inferInsert> = {};
  if (patch.accountId !== undefined) set.accountId = patch.accountId;
  if (patch.campaignId !== undefined) set.campaignId = patch.campaignId;
  if (patch.exportId !== undefined) set.exportId = patch.exportId;
  if (patch.exportName !== undefined) set.exportName = patch.exportName;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.scheduledAt !== undefined) set.scheduledAt = patch.scheduledAt;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.source !== undefined) set.source = patch.source;
  if (patch.queuePosition !== undefined) {
    set.queuePosition = patch.queuePosition ?? null;
  }
  if (patch.createdAt !== undefined) set.createdAt = patch.createdAt;
  if (patch.publishedAt !== undefined) set.publishedAt = patch.publishedAt;
  if (patch.youtubeVideoId !== undefined) {
    set.youtubeVideoId = patch.youtubeVideoId ?? null;
  }
  if (patch.error !== undefined) set.error = patch.error;
  return set;
}

async function readMetaRow(campaignId: string) {
  const rows = await getDb()
    .select()
    .from(youtubeMetaTable)
    .where(eq(youtubeMetaTable.id, campaignId))
    .limit(1);
  return rows[0] ?? null;
}

async function ensureMetaRow(campaignId: string) {
  const current = await readMetaRow(campaignId);
  if (current) return current;
  await getDb().insert(youtubeMetaTable).values({ id: campaignId });
  return (await readMetaRow(campaignId))!;
}

async function patchMetaRow(
  campaignId: string,
  patch: Partial<{
    publishedExportIds: string[];
    accountLastPublishedAt: Record<string, string>;
    accountPostingGoals: Record<string, AccountPostingGoal>;
    quotaExhaustedUntil: string | null;
  }>,
) {
  await ensureMetaRow(campaignId);
  const set: Partial<typeof youtubeMetaTable.$inferInsert> = {};
  if (patch.publishedExportIds !== undefined) {
    set.publishedExportIds = patch.publishedExportIds;
  }
  if (patch.accountLastPublishedAt !== undefined) {
    set.accountLastPublishedAt = patch.accountLastPublishedAt;
  }
  if (patch.accountPostingGoals !== undefined) {
    set.accountPostingGoals = patch.accountPostingGoals;
  }
  if (patch.quotaExhaustedUntil !== undefined) {
    set.quotaExhaustedUntil = patch.quotaExhaustedUntil;
  }
  if (Object.keys(set).length === 0) return;
  await getDb()
    .update(youtubeMetaTable)
    .set(set)
    .where(eq(youtubeMetaTable.id, campaignId));
}

async function accountCampaignId(accountId: string): Promise<string | null> {
  const rows = await getDb()
    .select({ campaignId: youtubeAccountsTable.campaignId })
    .from(youtubeAccountsTable)
    .where(eq(youtubeAccountsTable.id, accountId))
    .limit(1);
  return rows[0]?.campaignId ?? null;
}

const scheduledPostsBaseFilter = and(
  ne(youtubeScheduledPostsTable.source, "auto"),
  or(
    inArray(youtubeScheduledPostsTable.status, [
      "scheduled",
      "queued",
      "publishing",
      "failed",
    ]),
    and(
      eq(youtubeScheduledPostsTable.status, "published"),
      sql`${youtubeScheduledPostsTable.scheduledAt} >= now() - interval '90 days'`,
    ),
  ),
);

const scheduledPostsQuery = (campaignId?: string) => {
  const filters = campaignId
    ? and(
        eq(youtubeScheduledPostsTable.campaignId, campaignId),
        scheduledPostsBaseFilter,
      )
    : scheduledPostsBaseFilter;
  return getDb()
    .select()
    .from(youtubeScheduledPostsTable)
    .where(filters)
    .orderBy(desc(youtubeScheduledPostsTable.createdAt));
};

function buildYouTubeData(
  campaignId: string,
  accounts: YouTubeAccount[],
  posts: YouTubeScheduledPost[],
  meta: Awaited<ReturnType<typeof ensureMetaRow>>,
): YouTubeData {
  const accountIds = new Set(accounts.map((a) => a.id));
  const scopedPosts = posts.filter(
    (post) =>
      post.campaignId === campaignId && accountIds.has(post.accountId),
  );
  return normalize({
    accounts,
    scheduledPosts: scopedPosts,
    publishedExportIds: meta.publishedExportIds ?? [],
    accountLastPublishedAt: Object.fromEntries(
      Object.entries(meta.accountLastPublishedAt ?? {}).filter(([id]) =>
        accountIds.has(id),
      ),
    ),
    accountPostingGoals: Object.fromEntries(
      Object.entries(meta.accountPostingGoals ?? {}).filter(([id]) =>
        accountIds.has(id),
      ),
    ),
    quotaExhaustedUntil: meta.quotaExhaustedUntil,
  });
}

export async function readYouTubePg(campaignId: string): Promise<YouTubeData> {
  const db = getDb();
  const accounts = await dbQuery(
    () =>
      db
        .select()
        .from(youtubeAccountsTable)
        .where(eq(youtubeAccountsTable.campaignId, campaignId)),
    "read youtube accounts",
  );
  const posts = await dbQuery(
    () => scheduledPostsQuery(campaignId),
    "read youtube scheduled posts",
  );
  const meta = await dbQuery(
    () => ensureMetaRow(campaignId),
    "read youtube meta",
  );

  return buildYouTubeData(
    campaignId,
    accounts.map(rowToAccount),
    posts.map(rowToScheduledPost),
    meta,
  );
}

export async function readYouTubePgAll(): Promise<YouTubeData> {
  const db = getDb();
  const accounts = await dbQuery(
    () => db.select().from(youtubeAccountsTable),
    "read youtube accounts",
  );
  const posts = await dbQuery(
    () => scheduledPostsQuery(),
    "read youtube scheduled posts",
  );
  const metaRows = await dbQuery(
    () => db.select().from(youtubeMetaTable),
    "read youtube meta",
  );

  const publishedExportIds = new Set<string>();
  const accountLastPublishedAt: Record<string, string> = {};
  const accountPostingGoals: Record<string, AccountPostingGoal> = {};
  let quotaExhaustedUntil: string | null = null;

  for (const meta of metaRows) {
    for (const id of meta.publishedExportIds ?? []) publishedExportIds.add(id);
    Object.assign(accountLastPublishedAt, meta.accountLastPublishedAt ?? {});
    Object.assign(accountPostingGoals, meta.accountPostingGoals ?? {});
    if (meta.quotaExhaustedUntil) quotaExhaustedUntil = meta.quotaExhaustedUntil;
  }

  return normalize({
    accounts: accounts.map(rowToAccount),
    scheduledPosts: posts.map(rowToScheduledPost),
    publishedExportIds: [...publishedExportIds],
    accountLastPublishedAt,
    accountPostingGoals,
    quotaExhaustedUntil,
  });
}

export async function upsertYouTubeAccountsPg(
  accounts: YouTubeAccount[],
): Promise<YouTubeAccount[]> {
  const db = getDb();
  for (const account of accounts) {
    if (!account.campaignId) {
      throw new Error("campaignId is required when connecting YouTube.");
    }
    const existing = await db
      .select({ id: youtubeAccountsTable.id })
      .from(youtubeAccountsTable)
      .where(
        and(
          eq(youtubeAccountsTable.channelId, account.channelId),
          eq(youtubeAccountsTable.campaignId, account.campaignId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(youtubeAccountsTable)
        .set(accountValues({ ...account, id: existing[0].id }))
        .where(eq(youtubeAccountsTable.id, existing[0].id));
    } else {
      await db.insert(youtubeAccountsTable).values(accountValues(account));
    }
  }

  const campaignId = accounts[0]?.campaignId;
  if (!campaignId) return accounts;
  const rows = await db
    .select()
    .from(youtubeAccountsTable)
    .where(eq(youtubeAccountsTable.campaignId, campaignId));
  return rows.map(rowToAccount);
}

export async function updateYouTubeAccountPg(
  id: string,
  patch: Partial<Pick<YouTubeAccount, "accessToken" | "tokenExpiresAt" | "refreshToken">>,
) {
  const set: Partial<typeof youtubeAccountsTable.$inferInsert> = {};
  if (patch.accessToken !== undefined) set.accessToken = patch.accessToken;
  if (patch.tokenExpiresAt !== undefined) set.tokenExpiresAt = patch.tokenExpiresAt;
  if (patch.refreshToken !== undefined) set.refreshToken = patch.refreshToken;
  if (Object.keys(set).length === 0) return;
  await getDb()
    .update(youtubeAccountsTable)
    .set(set)
    .where(eq(youtubeAccountsTable.id, id));
}

export async function removeYouTubeAccountPg(id: string): Promise<void> {
  const campaignId = await accountCampaignId(id);
  await getDb()
    .delete(youtubeAccountsTable)
    .where(eq(youtubeAccountsTable.id, id));

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

  await getDb()
    .update(youtubeScheduledPostsTable)
    .set({ status: "cancelled", error: "Account disconnected" })
    .where(
      and(
        eq(youtubeScheduledPostsTable.accountId, id),
        inArray(youtubeScheduledPostsTable.status, ["scheduled", "queued"]),
      ),
    );
}

export async function setYouTubeAccountPostingGoalPg(
  accountId: string,
  goal: AccountPostingGoal,
) {
  const campaignId = await accountCampaignId(accountId);
  if (!campaignId) throw new Error("YouTube account not found.");
  const meta = await ensureMetaRow(campaignId);
  const accountPostingGoals = {
    ...(meta.accountPostingGoals ?? {}),
    [accountId]: normalizePostingGoal(goal),
  };
  await patchMetaRow(campaignId, { accountPostingGoals });
  return accountPostingGoals[accountId]!;
}

export async function setYouTubeQuotaExhaustedUntilPgAll(
  until: string | null,
) {
  const rows = await getDb().select({ id: youtubeMetaTable.id }).from(youtubeMetaTable);
  for (const row of rows) {
    await patchMetaRow(row.id, { quotaExhaustedUntil: until });
  }
  return until;
}

export async function recordYouTubeAccountPublishedPg(
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

export async function markYouTubeExportPublishedPg(
  exportId: string,
  campaignId: string,
) {
  const meta = await ensureMetaRow(campaignId);
  const publishedExportIds = meta.publishedExportIds ?? [];
  if (!publishedExportIds.includes(exportId)) {
    await patchMetaRow(campaignId, {
      publishedExportIds: [...publishedExportIds, exportId],
    });
  }
}

export async function addYouTubeScheduledPostPg(post: YouTubeScheduledPost) {
  await getDb()
    .insert(youtubeScheduledPostsTable)
    .values(scheduledPostValues(post));
  return post;
}

export async function addYouTubeScheduledPostsPg(posts: YouTubeScheduledPost[]) {
  if (!posts.length) return posts;
  await getDb()
    .insert(youtubeScheduledPostsTable)
    .values(posts.map(scheduledPostValues));
  return posts;
}

export async function updateYouTubeScheduledPostPg(
  id: string,
  patch: Partial<YouTubeScheduledPost>,
) {
  const set = scheduledPostPatch(patch);
  if (Object.keys(set).length === 0) {
    const rows = await getDb()
      .select()
      .from(youtubeScheduledPostsTable)
      .where(eq(youtubeScheduledPostsTable.id, id))
      .limit(1);
    return rows[0] ? rowToScheduledPost(rows[0]) : null;
  }

  const rows = await getDb()
    .update(youtubeScheduledPostsTable)
    .set(set)
    .where(eq(youtubeScheduledPostsTable.id, id))
    .returning();
  return rows[0] ? rowToScheduledPost(rows[0]) : null;
}

export async function removeYouTubeScheduledPostPg(id: string) {
  await getDb()
    .delete(youtubeScheduledPostsTable)
    .where(eq(youtubeScheduledPostsTable.id, id));
}

export async function purgeExportFromYouTubePg(exportId: string) {
  const metaRows = await getDb().select().from(youtubeMetaTable);
  for (const meta of metaRows) {
    const publishedExportIds = (meta.publishedExportIds ?? []).filter(
      (id) => id !== exportId,
    );
    if (publishedExportIds.length !== (meta.publishedExportIds ?? []).length) {
      await patchMetaRow(meta.id, { publishedExportIds });
    }
  }
  await getDb()
    .delete(youtubeScheduledPostsTable)
    .where(eq(youtubeScheduledPostsTable.exportId, exportId));
}

export async function removeYouTubeExportReferencesPg(exportId: string) {
  await getDb()
    .update(youtubeScheduledPostsTable)
    .set({ status: "cancelled", error: "Video deleted" })
    .where(
      and(
        eq(youtubeScheduledPostsTable.exportId, exportId),
        inArray(youtubeScheduledPostsTable.status, [
          "queued",
          "scheduled",
          "failed",
          "publishing",
        ]),
      ),
    );
}

export async function getYouTubeAccountByIdPg(
  id: string,
): Promise<YouTubeAccount | null> {
  const rows = await getDb()
    .select()
    .from(youtubeAccountsTable)
    .where(eq(youtubeAccountsTable.id, id))
    .limit(1);
  return rows[0] ? rowToAccount(rows[0]) : null;
}
