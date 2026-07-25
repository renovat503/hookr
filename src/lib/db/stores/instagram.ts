import { and, desc, eq, inArray } from "drizzle-orm";
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

function accountValues(account: InstagramAccount) {
  return {
    id: account.id,
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

async function patchMetaRow(
  patch: Partial<{
    publishedExportIds: string[];
    accountLastPublishedAt: Record<string, string>;
    autoPostEnabled: boolean;
    autoPostIntervalHours: number;
    accountPostingGoals: Record<string, AccountPostingGoal>;
    apiRateLimitedUntil: string | null;
  }>,
) {
  await ensureMetaRow();
  const set: Partial<typeof instagramMetaTable.$inferInsert> = {};
  if (patch.publishedExportIds !== undefined) {
    set.publishedExportIds = patch.publishedExportIds;
  }
  if (patch.accountLastPublishedAt !== undefined) {
    set.accountLastPublishedAt = patch.accountLastPublishedAt;
  }
  if (patch.autoPostEnabled !== undefined) {
    set.autoPostEnabled = patch.autoPostEnabled;
  }
  if (patch.autoPostIntervalHours !== undefined) {
    set.autoPostIntervalHours = patch.autoPostIntervalHours;
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
    .where(eq(instagramMetaTable.id, META_ID));
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

  await patchMetaRow({
    publishedExportIds: normalized.publishedExportIds,
    accountLastPublishedAt: normalized.accountLastPublishedAt,
    autoPostEnabled: normalized.autoPostEnabled,
    autoPostIntervalHours: normalized.autoPostIntervalHours,
    accountPostingGoals: normalized.accountPostingGoals ?? {},
    apiRateLimitedUntil: normalized.apiRateLimitedUntil,
  });
}

export async function upsertInstagramAccountsPg(
  accounts: InstagramAccount[],
): Promise<InstagramAccount[]> {
  const db = getDb();
  for (const account of accounts) {
    const existing = await db
      .select({ id: instagramAccountsTable.id })
      .from(instagramAccountsTable)
      .where(eq(instagramAccountsTable.igUserId, account.igUserId))
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

  const rows = await db.select().from(instagramAccountsTable);
  return rows.map(rowToAccount);
}

export async function removeInstagramAccountPg(id: string): Promise<void> {
  const db = getDb();
  await db
    .delete(instagramAccountsTable)
    .where(eq(instagramAccountsTable.id, id));

  const meta = await ensureMetaRow();
  const accountLastPublishedAt = { ...(meta.accountLastPublishedAt ?? {}) };
  delete accountLastPublishedAt[id];
  await patchMetaRow({ accountLastPublishedAt });

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

export async function setAutoPostSettingsPg(patch: {
  enabled?: boolean;
  intervalHours?: number;
}) {
  const meta = await ensureMetaRow();
  const next = {
    autoPostEnabled:
      typeof patch.enabled === "boolean"
        ? patch.enabled
        : meta.autoPostEnabled,
    autoPostIntervalHours:
      patch.intervalHours !== undefined
        ? normalizeAutoPostIntervalHours(patch.intervalHours)
        : normalizeAutoPostIntervalHours(meta.autoPostIntervalHours),
  };
  await patchMetaRow(next);
  return next;
}

export async function setAccountPostingGoalPg(
  accountId: string,
  goal: AccountPostingGoal,
) {
  const meta = await ensureMetaRow();
  const accountPostingGoals = {
    ...(meta.accountPostingGoals ?? {}),
    [accountId]: normalizePostingGoal(goal),
  };
  await patchMetaRow({ accountPostingGoals });
  return accountPostingGoals[accountId]!;
}

export async function setApiRateLimitedUntilPg(until: string | null) {
  await patchMetaRow({ apiRateLimitedUntil: until });
  return until;
}

export async function clearApiRateLimitIfExpiredPg(now = Date.now()) {
  const meta = await ensureMetaRow();
  if (
    meta.apiRateLimitedUntil &&
    new Date(meta.apiRateLimitedUntil).getTime() <= now
  ) {
    await patchMetaRow({ apiRateLimitedUntil: null });
    return { ...meta, apiRateLimitedUntil: null };
  }
  return meta;
}

export async function recordAccountPublishedPg(
  accountId: string,
  publishedAt: string,
) {
  const meta = await ensureMetaRow();
  const prev = meta.accountLastPublishedAt?.[accountId];
  if (!prev || publishedAt > prev) {
    await patchMetaRow({
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
  const meta = await ensureMetaRow();
  const publishedExportIds = meta.publishedExportIds ?? [];
  if (!publishedExportIds.includes(exportId)) {
    await patchMetaRow({
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

  return readInstagramPg();
}

export async function markExportPublishedPg(exportId: string) {
  const meta = await ensureMetaRow();
  const publishedExportIds = meta.publishedExportIds ?? [];
  if (!publishedExportIds.includes(exportId)) {
    await patchMetaRow({
      publishedExportIds: [...publishedExportIds, exportId],
    });
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

  return readInstagramPg();
}

export async function removeScheduledPostPg(id: string) {
  await getDb()
    .delete(scheduledPostsTable)
    .where(eq(scheduledPostsTable.id, id));
}

export async function removeExportReferencesPg(exportId: string) {
  const meta = await ensureMetaRow();
  await patchMetaRow({
    publishedExportIds: (meta.publishedExportIds ?? []).filter(
      (id) => id !== exportId,
    ),
  });

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
  const meta = await ensureMetaRow();
  await patchMetaRow({
    publishedExportIds: (meta.publishedExportIds ?? []).filter(
      (id) => id !== exportId,
    ),
  });
  await getDb()
    .delete(scheduledPostsTable)
    .where(eq(scheduledPostsTable.exportId, exportId));
}

export async function writeInstagramStatePg(data: InstagramData): Promise<void> {
  await writeInstagramPg(data);
}
