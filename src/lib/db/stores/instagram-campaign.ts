import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  instagramAccounts as instagramAccountsTable,
  instagramMeta as instagramMetaTable,
  scheduledPosts as scheduledPostsTable,
} from "@/lib/db/schema";
import { readCampaigns } from "@/lib/campaign-store";

export const LEGACY_META_ID = "default";
const ORPHANED_EXPORT_ERROR =
  "Export no longer in library — re-produce and schedule again.";

let legacyMigrationDone = false;
let repairDone = false;

function campaignAccountId(campaignId: string, igUserId: string): string {
  return `ig-${campaignId}-${igUserId}`;
}

/** Assign pre-isolation Instagram data to the oldest campaign once. */
export async function migrateLegacyInstagramOnce(): Promise<void> {
  if (legacyMigrationDone) return;
  legacyMigrationDone = true;

  const db = getDb();
  const nullAccounts = await db
    .select({ id: instagramAccountsTable.id })
    .from(instagramAccountsTable)
    .where(isNull(instagramAccountsTable.campaignId))
    .limit(1);

  const defaultMetaRows = await db
    .select()
    .from(instagramMetaTable)
    .where(eq(instagramMetaTable.id, LEGACY_META_ID))
    .limit(1);

  const needsAccountMigration = nullAccounts.length > 0;

  if (!needsAccountMigration && !defaultMetaRows.length) {
    return;
  }

  const { campaigns } = await readCampaigns();
  const oldest = campaigns.length ? campaigns[campaigns.length - 1]! : null;
  if (!oldest) return;

  if (needsAccountMigration) {
    await db
      .update(instagramAccountsTable)
      .set({ campaignId: oldest.id })
      .where(isNull(instagramAccountsTable.campaignId));

    await db
      .update(scheduledPostsTable)
      .set({ campaignId: oldest.id })
      .where(isNull(scheduledPostsTable.campaignId));
  }

  const campaignMeta = await db
    .select({ id: instagramMetaTable.id })
    .from(instagramMetaTable)
    .where(eq(instagramMetaTable.id, oldest.id))
    .limit(1);

  if (defaultMetaRows[0] && !campaignMeta.length) {
    const legacy = defaultMetaRows[0];
    await db.insert(instagramMetaTable).values({
      id: oldest.id,
      publishedExportIds: legacy.publishedExportIds ?? [],
      accountLastPublishedAt: legacy.accountLastPublishedAt ?? {},
      accountPostingGoals: legacy.accountPostingGoals ?? {},
      apiRateLimitedUntil: legacy.apiRateLimitedUntil,
    });
  }
}

/**
 * Reassign Instagram schedules to the campaign that owns each export,
 * clone connected accounts per campaign, and fail orphaned schedules.
 */
export async function repairInstagramCampaignScope(): Promise<void> {
  if (repairDone) return;
  repairDone = true;

  await migrateLegacyInstagramOnce();

  const db = getDb();

  await db.execute(sql`
    UPDATE exports AS e
    SET campaign_id = h.campaign_id
    FROM hooks AS h
    WHERE e.hook_id = h.id
      AND e.campaign_id IS NULL
      AND h.campaign_id IS NOT NULL
  `);

  await db.execute(sql`
    UPDATE scheduled_posts AS sp
    SET campaign_id = e.campaign_id
    FROM exports AS e
    WHERE sp.export_id = e.id
      AND e.campaign_id IS NOT NULL
      AND sp.campaign_id IS DISTINCT FROM e.campaign_id
  `);

  const orphaned = await db
    .select({ id: scheduledPostsTable.id })
    .from(scheduledPostsTable)
    .where(
      and(
        inArray(scheduledPostsTable.status, ["scheduled", "queued", "pending"]),
        sql`NOT EXISTS (
          SELECT 1 FROM exports AS e
          WHERE e.id = ${scheduledPostsTable.exportId}
        )`,
      ),
    );

  if (orphaned.length) {
    await db
      .update(scheduledPostsTable)
      .set({
        status: "failed",
        error: ORPHANED_EXPORT_ERROR,
      })
      .where(
        inArray(
          scheduledPostsTable.id,
          orphaned.map((row) => row.id),
        ),
      );
  }

  const activePosts = await db
    .select()
    .from(scheduledPostsTable)
    .where(
      inArray(scheduledPostsTable.status, ["scheduled", "queued", "pending"]),
    );

  if (!activePosts.length) return;

  const accountRows = await db.select().from(instagramAccountsTable);
  const accountsById = new Map(accountRows.map((row) => [row.id, row]));

  for (const post of activePosts) {
    if (!post.campaignId) continue;
    const account = accountsById.get(post.accountId);
    if (!account) continue;

    if (account.campaignId === post.campaignId) continue;

    const expectedId = campaignAccountId(post.campaignId, account.igUserId);
    let target = accountRows.find(
      (row) =>
        row.campaignId === post.campaignId &&
        row.igUserId === account.igUserId,
    );

    if (!target) {
      await db.insert(instagramAccountsTable).values({
        id: expectedId,
        campaignId: post.campaignId,
        igUserId: account.igUserId,
        username: account.username,
        profilePictureUrl: account.profilePictureUrl,
        pageId: account.pageId,
        pageName: account.pageName,
        accessToken: account.accessToken,
        connectedAt: account.connectedAt,
        tokenExpiresAt: account.tokenExpiresAt,
      });
      target = {
        ...account,
        id: expectedId,
        campaignId: post.campaignId,
      };
      accountRows.push(target);
      accountsById.set(expectedId, target);
    }

    if (post.accountId !== target.id) {
      await db
        .update(scheduledPostsTable)
        .set({ accountId: target.id })
        .where(eq(scheduledPostsTable.id, post.id));
    }
  }
}
