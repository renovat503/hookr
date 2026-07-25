import { cookies } from "next/headers";
import { CAMPAIGN_COOKIE } from "@/lib/auth";
import { getCampaign } from "@/lib/campaign-store";
import { isCampaignClosed } from "@/lib/campaign-status";
import type { Campaign } from "@/lib/types";

export async function getActiveCampaignId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(CAMPAIGN_COOKIE)?.value?.trim() ?? null;
}

export async function getActiveCampaign(): Promise<Campaign | null> {
  const id = await getActiveCampaignId();
  if (!id) return null;
  return getCampaign(id);
}

export async function requireActiveCampaignId(options?: {
  allowClosed?: boolean;
}): Promise<string> {
  const id = await getActiveCampaignId();
  if (!id) {
    throw new Error("Select an active campaign before creating hooks.");
  }
  if (!options?.allowClosed) {
    const campaign = await getCampaign(id);
    if (campaign && isCampaignClosed(campaign)) {
      throw new Error(
        "This campaign is closed. Reopen it in campaign settings to add hooks.",
      );
    }
  }
  return id;
}
