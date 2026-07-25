import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import {
  usesJsonWrite,
  usesPostgresRead,
  usesPostgresWrite,
} from "@/lib/config/storage-mode";
import {
  addCampaignPg,
  getCampaignPg,
  readCampaignsPg,
  removeCampaignPg,
  updateCampaignPg,
  writeCampaignsPg,
} from "@/lib/db/stores/campaigns";
import type { Campaign, CampaignsData } from "./types";
import { DEFAULT_MUSIC_VOLUME } from "./constants";

const DATA_DIR = path.join(process.cwd(), "data");
const CAMPAIGNS_PATH = path.join(DATA_DIR, "campaigns.json");

const EMPTY: CampaignsData = { campaigns: [] };

function sanitizeBorrowedAssetIds(campaign: Campaign): Campaign {
  if (!campaign.borrowFromCampaignId || !campaign.borrowAssetKind) {
    return campaign;
  }
  if (campaign.borrowAssetKind === "hooks") {
    return { ...campaign, hookIds: [] };
  }
  return { ...campaign, demoIds: [] };
}

function normalizeCampaign(raw: unknown): Campaign | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<Campaign>;
  if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  const campaign: Campaign = {
    id: item.id,
    name: item.name.trim(),
    hookIds: Array.isArray(item.hookIds)
      ? item.hookIds.filter((id): id is string => typeof id === "string")
      : [],
    demoIds: Array.isArray(item.demoIds)
      ? item.demoIds.filter((id): id is string => typeof id === "string")
      : [],
    captionIds: Array.isArray(item.captionIds)
      ? item.captionIds.filter((id): id is string => typeof id === "string")
      : [],
    useCaptions: Boolean(item.useCaptions),
    audioMode:
      item.audioMode === "random" || item.audioMode === "fixed"
        ? item.audioMode
        : "none",
    musicId: typeof item.musicId === "string" ? item.musicId : null,
    musicVolume:
      typeof item.musicVolume === "number"
        ? Math.min(100, Math.max(0, Math.round(item.musicVolume)))
        : DEFAULT_MUSIC_VOLUME,
    randomFormat: item.randomFormat !== false,
    borrowFromCampaignId:
      typeof item.borrowFromCampaignId === "string"
        ? item.borrowFromCampaignId
        : null,
    borrowAssetKind:
      item.borrowAssetKind === "hooks" || item.borrowAssetKind === "demos"
        ? item.borrowAssetKind
        : null,
    status: item.status === "closed" ? "closed" : "open",
    createdAt:
      typeof item.createdAt === "string"
        ? item.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof item.updatedAt === "string"
        ? item.updatedAt
        : new Date().toISOString(),
  };
  return sanitizeBorrowedAssetIds(campaign);
}

async function readCampaignsJson(): Promise<CampaignsData> {
  try {
    const raw = await readFile(CAMPAIGNS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CampaignsData>;
    const campaigns = (parsed.campaigns ?? [])
      .map(normalizeCampaign)
      .filter((c): c is Campaign => c != null);

    const rawCampaigns = parsed.campaigns ?? [];
    const needsRepair = campaigns.some((fixed, index) => {
      const original = rawCampaigns[index] as Partial<Campaign> | undefined;
      if (!original) return false;
      const origHooks = JSON.stringify(original.hookIds ?? []);
      const origDemos = JSON.stringify(original.demoIds ?? []);
      return (
        origHooks !== JSON.stringify(fixed.hookIds) ||
        origDemos !== JSON.stringify(fixed.demoIds)
      );
    });
    if (needsRepair) {
      await writeCampaignsJson({ campaigns });
    }

    return { campaigns };
  } catch {
    return { ...EMPTY };
  }
}

async function writeCampaignsJson(data: CampaignsData) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CAMPAIGNS_PATH, JSON.stringify(data, null, 2));
}

export function createCampaignId(): string {
  return `camp-${Date.now()}`;
}

export async function readCampaigns(): Promise<CampaignsData> {
  if (usesPostgresRead()) {
    try {
      return await readCampaignsPg();
    } catch (err) {
      console.error("[campaigns] postgres read failed, falling back to json", err);
    }
  }
  return readCampaignsJson();
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  if (usesPostgresRead()) {
    try {
      const campaign = await getCampaignPg(id);
      if (campaign) return campaign;
    } catch (err) {
      console.error("[campaigns] postgres get failed, falling back to json", err);
    }
  }
  const data = await readCampaignsJson();
  return data.campaigns.find((c) => c.id === id) ?? null;
}

export async function getActiveCampaign(
  activeId: string | null | undefined,
): Promise<Campaign | null> {
  if (!activeId) return null;
  return getCampaign(activeId);
}

export async function addCampaign(
  input: Omit<Campaign, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<Campaign> {
  const now = new Date().toISOString();
  const campaign: Campaign = sanitizeBorrowedAssetIds({
    id: input.id ?? createCampaignId(),
    name: input.name.trim(),
    hookIds: [...input.hookIds],
    demoIds: [...input.demoIds],
    captionIds: [...input.captionIds],
    useCaptions: input.useCaptions,
    audioMode: input.audioMode,
    musicId: input.musicId,
    musicVolume: input.musicVolume,
    randomFormat: input.randomFormat,
    borrowFromCampaignId: input.borrowFromCampaignId ?? null,
    borrowAssetKind: input.borrowAssetKind ?? null,
    status: input.status ?? "open",
    createdAt: now,
    updatedAt: now,
  });

  if (usesJsonWrite()) {
    const data = await readCampaignsJson();
    data.campaigns.unshift(campaign);
    await writeCampaignsJson(data);
  }
  if (usesPostgresWrite()) {
    try {
      await addCampaignPg(campaign);
    } catch (err) {
      console.error("[campaigns] postgres add failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }

  return campaign;
}

export async function updateCampaign(
  id: string,
  patch: Partial<Omit<Campaign, "id" | "createdAt">>,
): Promise<Campaign | null> {
  if (usesPostgresWrite()) {
    try {
      const updated = await updateCampaignPg(id, patch);
      if (updated) {
        if (usesJsonWrite()) {
          const data = await readCampaignsJson();
          const index = data.campaigns.findIndex((c) => c.id === id);
          if (index >= 0) {
            data.campaigns[index] = updated;
            await writeCampaignsJson(data);
          }
        }
        return updated;
      }
    } catch (err) {
      console.error("[campaigns] postgres update failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }

  const data = await readCampaignsJson();
  const index = data.campaigns.findIndex((c) => c.id === id);
  if (index < 0) return null;
  const current = data.campaigns[index];
  const next: Campaign = sanitizeBorrowedAssetIds({
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
    status:
      patch.status === "closed" || patch.status === "open"
        ? patch.status
        : current.status ?? "open",
    updatedAt: new Date().toISOString(),
  });
  data.campaigns[index] = next;
  if (usesJsonWrite()) {
    await writeCampaignsJson(data);
  }
  return next;
}

export async function removeCampaign(id: string): Promise<boolean> {
  if (usesPostgresWrite()) {
    try {
      const ok = await removeCampaignPg(id);
      if (ok && usesJsonWrite()) {
        const data = await readCampaignsJson();
        const campaigns = data.campaigns
          .filter((c) => c.id !== id)
          .map((c) =>
            c.borrowFromCampaignId === id
              ? { ...c, borrowFromCampaignId: null, borrowAssetKind: null }
              : c,
          );
        await writeCampaignsJson({ campaigns });
      }
      if (ok || !usesJsonWrite()) return ok;
    } catch (err) {
      console.error("[campaigns] postgres remove failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }

  const data = await readCampaignsJson();
  if (!data.campaigns.some((c) => c.id === id)) return false;
  const campaigns = data.campaigns
    .filter((c) => c.id !== id)
    .map((c) =>
      c.borrowFromCampaignId === id
        ? { ...c, borrowFromCampaignId: null, borrowAssetKind: null }
        : c,
    );
  if (usesJsonWrite()) {
    await writeCampaignsJson({ campaigns });
  }
  return true;
}

/** Bulk replace campaigns — used by migration tooling. */
export async function replaceAllCampaigns(data: CampaignsData): Promise<void> {
  if (usesJsonWrite()) {
    await writeCampaignsJson(data);
  }
  if (usesPostgresWrite()) {
    await writeCampaignsPg(data);
  }
}
