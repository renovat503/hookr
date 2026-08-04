import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { dbQuery } from "@/lib/db/query";
import { campaigns as campaignsTable } from "@/lib/db/schema";
import type { Campaign, CampaignsData } from "@/lib/types";
import { DEFAULT_MUSIC_VOLUME } from "@/lib/constants";

function rowToCampaign(row: typeof campaignsTable.$inferSelect): Campaign {
  return {
    id: row.id,
    name: row.name,
    status: row.status === "closed" ? "closed" : "open",
    hookIds: row.hookIds ?? [],
    demoIds: row.demoIds ?? [],
    captionIds: row.captionIds ?? [],
    useCaptions: row.useCaptions,
    audioMode: row.audioMode,
    musicId: row.musicId,
    musicVolume: row.musicVolume ?? DEFAULT_MUSIC_VOLUME,
    randomFormat: row.randomFormat,
    borrowFromCampaignId: row.borrowFromCampaignId,
    borrowAssetKind: row.borrowAssetKind,
    borrowMusicFromCampaignId: row.borrowMusicFromCampaignId,
    copiedFromCampaignId: row.copiedFromCampaignId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sanitizeBorrowedAssetIds(campaign: Campaign): Campaign {
  if (!campaign.borrowFromCampaignId || !campaign.borrowAssetKind) {
    return campaign;
  }
  if (campaign.borrowAssetKind === "hooks") {
    return { ...campaign, hookIds: [] };
  }
  return { ...campaign, demoIds: [] };
}

export async function readCampaignsPg(): Promise<CampaignsData> {
  const rows = await dbQuery(
    () =>
      getDb()
        .select()
        .from(campaignsTable)
        .orderBy(desc(campaignsTable.createdAt)),
    "read campaigns",
  );
  return {
    campaigns: rows.map((row) => sanitizeBorrowedAssetIds(rowToCampaign(row))),
  };
}

export async function getCampaignPg(id: string): Promise<Campaign | null> {
  const rows = await getDb()
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id))
    .limit(1);
  const row = rows[0];
  return row ? sanitizeBorrowedAssetIds(rowToCampaign(row)) : null;
}

export async function addCampaignPg(campaign: Campaign): Promise<Campaign> {
  const next = sanitizeBorrowedAssetIds(campaign);
  await getDb().insert(campaignsTable).values({
    id: next.id,
    name: next.name,
    status: next.status,
    hookIds: next.hookIds,
    demoIds: next.demoIds,
    captionIds: next.captionIds,
    useCaptions: next.useCaptions,
    audioMode: next.audioMode,
    musicId: next.musicId,
    musicVolume: next.musicVolume,
    randomFormat: next.randomFormat,
    borrowFromCampaignId: next.borrowFromCampaignId,
    borrowAssetKind: next.borrowAssetKind,
    borrowMusicFromCampaignId: next.borrowMusicFromCampaignId,
    copiedFromCampaignId: next.copiedFromCampaignId,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
  });
  return next;
}

export async function updateCampaignPg(
  id: string,
  patch: Partial<Omit<Campaign, "id" | "createdAt">>,
): Promise<Campaign | null> {
  const current = await getCampaignPg(id);
  if (!current) return null;

  const next = sanitizeBorrowedAssetIds({
    ...current,
    ...patch,
    name: patch.name?.trim() ?? current.name,
    hookIds: patch.hookIds ? [...patch.hookIds] : current.hookIds,
    demoIds: patch.demoIds ? [...patch.demoIds] : current.demoIds,
    captionIds: patch.captionIds ? [...patch.captionIds] : current.captionIds,
    borrowFromCampaignId:
      patch.borrowFromCampaignId !== undefined
        ? patch.borrowFromCampaignId
        : current.borrowFromCampaignId ?? null,
    borrowAssetKind:
      patch.borrowAssetKind !== undefined
        ? patch.borrowAssetKind
        : current.borrowAssetKind ?? null,
    borrowMusicFromCampaignId:
      patch.borrowMusicFromCampaignId !== undefined
        ? patch.borrowMusicFromCampaignId
        : current.borrowMusicFromCampaignId ?? null,
    copiedFromCampaignId:
      patch.copiedFromCampaignId !== undefined
        ? patch.copiedFromCampaignId
        : current.copiedFromCampaignId ?? null,
    status:
      patch.status === "closed" || patch.status === "open"
        ? patch.status
        : current.status ?? "open",
    updatedAt: new Date().toISOString(),
  });

  await getDb()
    .update(campaignsTable)
    .set({
      name: next.name,
      status: next.status,
      hookIds: next.hookIds,
      demoIds: next.demoIds,
      captionIds: next.captionIds,
      useCaptions: next.useCaptions,
      audioMode: next.audioMode,
      musicId: next.musicId,
      musicVolume: next.musicVolume,
      randomFormat: next.randomFormat,
      borrowFromCampaignId: next.borrowFromCampaignId,
      borrowAssetKind: next.borrowAssetKind,
      borrowMusicFromCampaignId: next.borrowMusicFromCampaignId,
      copiedFromCampaignId: next.copiedFromCampaignId,
      updatedAt: next.updatedAt,
    })
    .where(eq(campaignsTable.id, id));

  return next;
}

export async function removeCampaignPg(id: string): Promise<boolean> {
  const current = await getCampaignPg(id);
  if (!current) return false;

  const all = await readCampaignsPg();
  for (const campaign of all.campaigns) {
    if (campaign.borrowFromCampaignId === id) {
      await updateCampaignPg(campaign.id, {
        borrowFromCampaignId: null,
        borrowAssetKind: null,
      });
    }
    if (campaign.borrowMusicFromCampaignId === id) {
      await updateCampaignPg(campaign.id, {
        borrowMusicFromCampaignId: null,
      });
    }
  }

  const deleted = await getDb()
    .delete(campaignsTable)
    .where(eq(campaignsTable.id, id))
    .returning({ id: campaignsTable.id });
  return deleted.length > 0;
}

export async function writeCampaignsPg(data: CampaignsData): Promise<void> {
  const db = getDb();
  await db.delete(campaignsTable);
  if (!data.campaigns.length) return;
  await db.insert(campaignsTable).values(
    data.campaigns.map((campaign) => {
      const next = sanitizeBorrowedAssetIds(campaign);
      return {
        id: next.id,
        name: next.name,
        status: next.status,
        hookIds: next.hookIds,
        demoIds: next.demoIds,
        captionIds: next.captionIds,
        useCaptions: next.useCaptions,
        audioMode: next.audioMode,
        musicId: next.musicId,
        musicVolume: next.musicVolume,
        randomFormat: next.randomFormat,
        borrowFromCampaignId: next.borrowFromCampaignId,
        borrowAssetKind: next.borrowAssetKind,
        borrowMusicFromCampaignId: next.borrowMusicFromCampaignId,
        copiedFromCampaignId: next.copiedFromCampaignId,
        createdAt: next.createdAt,
        updatedAt: next.updatedAt,
      };
    }),
  );
}
