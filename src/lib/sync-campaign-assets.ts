import { getActiveCampaignId } from "@/lib/active-campaign";
import {
  mergeCampaignAssets,
  ownedCampaignAssetPatch,
} from "@/lib/campaign-assets";
import { getCampaign, readCampaigns, updateCampaign } from "@/lib/campaign-store";
import { readLibrary } from "@/lib/library-store";
import type { Campaign } from "@/lib/types";

/** Merge new library assets into the active campaign and persist when changed. */
export async function syncActiveCampaignAssets(): Promise<Campaign | null> {
  const campaignId = await getActiveCampaignId();
  if (!campaignId) return null;

  const [campaign, library, campaignsData] = await Promise.all([
    getCampaign(campaignId),
    readLibrary(),
    readCampaigns(),
  ]);
  if (!campaign) return null;

  const merged = mergeCampaignAssets(campaign, library, campaignsData.campaigns);
  const assetPatch = ownedCampaignAssetPatch(campaign, merged);
  if (!assetPatch) return campaign;

  return updateCampaign(campaignId, assetPatch);
}

/** Add a newly created hook or demo to the active campaign's produce selection. */
export async function appendAssetToActiveCampaign(
  type: "hooks" | "demos",
  assetId: string,
): Promise<void> {
  const campaignId = await getActiveCampaignId();
  if (!campaignId) return;

  const campaign = await getCampaign(campaignId);
  if (!campaign) return;

  if (type === "hooks") {
    if (
      campaign.borrowAssetKind === "hooks" &&
      campaign.borrowFromCampaignId
    ) {
      return;
    }

    const library = await readLibrary();
    const hook = library.hooks.find((h) => h.id === assetId);
    if (!hook || hook.campaignId !== campaignId) return;
    if (campaign.hookIds.includes(assetId)) return;

    await updateCampaign(campaignId, {
      hookIds: [...campaign.hookIds, assetId],
    });
    return;
  }

  if (
    campaign.borrowAssetKind === "demos" &&
    campaign.borrowFromCampaignId
  ) {
    return;
  }

  if (campaign.demoIds.includes(assetId)) return;

  await updateCampaign(campaignId, {
    demoIds: [...campaign.demoIds, assetId],
  });
}
