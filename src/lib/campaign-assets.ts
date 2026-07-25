import type { Campaign, CampaignsData, LibraryData } from "./types";
import { ownedCompleteHookIds } from "./campaign-hooks";

export function resolveBorrowSource(
  campaign: Campaign,
  campaigns: Campaign[] = [],
): Campaign | null {
  if (!campaign.borrowFromCampaignId || !campaign.borrowAssetKind) return null;
  return campaigns.find((c) => c.id === campaign.borrowFromCampaignId) ?? null;
}

/** Hooks usable for production (exist in library, have overlay). */
export function resolveCampaignHookIds(
  campaign: Campaign,
  library: LibraryData,
  _options?: { allowAllWhenEmpty?: boolean },
): string[] {
  const ownedIds = ownedCompleteHookIds(campaign.id, library);

  if (!campaign.hookIds.length) {
    return [];
  }

  return campaign.hookIds.filter((id) => ownedIds.has(id));
}

export function resolveCampaignDemoIds(
  campaign: Campaign,
  library: LibraryData,
  options?: { allowAllWhenEmpty?: boolean },
): string[] {
  const allowAllWhenEmpty = options?.allowAllWhenEmpty ?? false;
  const libraryDemoIds = new Set(library.demos.map((d) => d.id));

  if (!campaign.demoIds.length) {
    return allowAllWhenEmpty ? [...libraryDemoIds] : [];
  }

  const selected = campaign.demoIds.filter((id) => libraryDemoIds.has(id));
  if (!allowAllWhenEmpty) {
    return selected;
  }

  const addedAfterSave = library.demos
    .filter(
      (d) =>
        !campaign.demoIds.includes(d.id) &&
        d.uploadedAt > campaign.updatedAt,
    )
    .map((d) => d.id);

  return [...new Set([...selected, ...addedAfterSave])];
}

export function mergeCampaignAssets(
  campaign: Campaign,
  library: LibraryData,
  campaigns: Campaign[] = [],
): { hookIds: string[]; demoIds: string[] } {
  let hookSource = campaign;
  let demoSource = campaign;

  const borrowSource = resolveBorrowSource(campaign, campaigns);
  const borrowingHooks = Boolean(
    borrowSource && campaign.borrowAssetKind === "hooks",
  );
  const borrowingDemos = Boolean(
    borrowSource && campaign.borrowAssetKind === "demos",
  );

  if (borrowingHooks) {
    hookSource = borrowSource!;
  } else if (borrowingDemos) {
    demoSource = borrowSource!;
  }

  return {
    hookIds: resolveCampaignHookIds(hookSource, library, {
      allowAllWhenEmpty: false,
    }),
    demoIds: resolveCampaignDemoIds(demoSource, library, {
      // Demos are library-global; source campaigns often have empty demoIds
      // because uploads were never synced — treat that as “all demos”.
      allowAllWhenEmpty: borrowingDemos,
    }),
  };
}

export function campaignAssetsChanged(
  campaign: Campaign,
  merged: { hookIds: string[]; demoIds: string[] },
): boolean {
  return ownedCampaignAssetPatch(campaign, merged) !== null;
}

/** Persist only asset ids this campaign owns — not borrowed hooks/demos. */
export function ownedCampaignAssetPatch(
  campaign: Campaign,
  merged: { hookIds: string[]; demoIds: string[] },
): Partial<Pick<Campaign, "hookIds" | "demoIds">> | null {
  const borrowingHooks = Boolean(
    campaign.borrowFromCampaignId && campaign.borrowAssetKind === "hooks",
  );
  const borrowingDemos = Boolean(
    campaign.borrowFromCampaignId && campaign.borrowAssetKind === "demos",
  );

  const patch: Partial<Pick<Campaign, "hookIds" | "demoIds">> = {};

  if (!borrowingHooks) {
    const sameHooks =
      merged.hookIds.length === campaign.hookIds.length &&
      merged.hookIds.every((id) => campaign.hookIds.includes(id));
    if (!sameHooks) patch.hookIds = merged.hookIds;
  }

  if (!borrowingDemos) {
    const sameDemos =
      merged.demoIds.length === campaign.demoIds.length &&
      merged.demoIds.every((id) => campaign.demoIds.includes(id));
    if (!sameDemos) patch.demoIds = merged.demoIds;
  }

  return Object.keys(patch).length ? patch : null;
}
