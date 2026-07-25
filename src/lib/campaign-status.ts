import type { Campaign } from "./types";

export function isCampaignClosed(campaign: Pick<Campaign, "status">): boolean {
  return campaign.status === "closed";
}

export function isCampaignOpen(campaign: Pick<Campaign, "status">): boolean {
  return !isCampaignClosed(campaign);
}
