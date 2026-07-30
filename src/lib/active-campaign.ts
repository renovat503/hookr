import { cookies } from "next/headers";
import { CAMPAIGN_COOKIE, campaignCookieOptions } from "@/lib/auth";
import { getCampaign, readCampaigns } from "@/lib/campaign-store";
import { isCampaignClosed } from "@/lib/campaign-status";
import type { Campaign } from "@/lib/types";

function campaignCookieSecure(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT)
  );
}

/** Active campaign from cookie, or the most recent campaign if none is selected. */
export async function resolveActiveCampaign(): Promise<Campaign | null> {
  const jar = await cookies();
  const cookieId = jar.get(CAMPAIGN_COOKIE)?.value?.trim() ?? null;

  if (cookieId) {
    const campaign = await getCampaign(cookieId);
    if (campaign) return campaign;
  }

  const { campaigns } = await readCampaigns();
  const fallback = campaigns[0] ?? null;
  if (!fallback) return null;

  jar.set(
    CAMPAIGN_COOKIE,
    fallback.id,
    campaignCookieOptions(campaignCookieSecure()),
  );
  return fallback;
}

export async function getActiveCampaignId(): Promise<string | null> {
  const campaign = await resolveActiveCampaign();
  return campaign?.id ?? null;
}

export async function getActiveCampaign(): Promise<Campaign | null> {
  return resolveActiveCampaign();
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
