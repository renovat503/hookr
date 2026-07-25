import type { Campaign, LibraryData, LibraryHook } from "./types";
import { isCompleteHook } from "./utils";

/** Hooks owned by this campaign (created or copied here). */
export function hooksOwnedByCampaign(
  campaignId: string,
  library: LibraryData,
): LibraryHook[] {
  return library.hooks.filter((h) => h.campaignId === campaignId);
}

export function ownedCompleteHookIds(
  campaignId: string,
  library: LibraryData,
): Set<string> {
  return new Set(
    hooksOwnedByCampaign(campaignId, library)
      .filter(isCompleteHook)
      .map((h) => h.id),
  );
}

export function isHookCopied(hook: LibraryHook): boolean {
  return Boolean(hook.copiedFromHookId || hook.copiedFromCampaignId);
}

export function hookCopyLabel(
  hook: LibraryHook,
  campaigns: Campaign[],
): string | null {
  if (!isHookCopied(hook)) return null;
  const source = campaigns.find((c) => c.id === hook.copiedFromCampaignId);
  return source ? `Copied from ${source.name}` : "Copied from another campaign";
}
