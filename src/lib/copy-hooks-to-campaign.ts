import { hooksOwnedByCampaign } from "@/lib/campaign-hooks";
import { getCampaign, updateCampaign } from "@/lib/campaign-store";
import { addHook, readLibrary } from "@/lib/library-store";
import { isCompleteHook } from "@/lib/utils";

export async function copyHooksToCampaign(
  sourceCampaignId: string,
  targetCampaignId: string,
  hookIds?: string[],
): Promise<string[]> {
  if (sourceCampaignId === targetCampaignId) {
    throw new Error("Choose a different campaign to copy from.");
  }

  const [targetCampaign, sourceCampaign, library] = await Promise.all([
    getCampaign(targetCampaignId),
    getCampaign(sourceCampaignId),
    readLibrary(),
  ]);

  if (!targetCampaign) {
    throw new Error("Target campaign not found.");
  }
  if (!sourceCampaign) {
    throw new Error("Source campaign not found.");
  }

  const sourceOwned = hooksOwnedByCampaign(sourceCampaignId, library).filter(
    isCompleteHook,
  );
  const sourceOwnedIds = new Set(sourceOwned.map((hook) => hook.id));
  const toCopy = hookIds?.length
    ? hookIds.filter((id) => sourceOwnedIds.has(id))
    : sourceOwned.map((hook) => hook.id);

  if (!toCopy.length) {
    throw new Error("No hooks available to copy from the source campaign.");
  }

  const stamp = Date.now();
  const copiedIds: string[] = [];
  const newHookIds = [...targetCampaign.hookIds];

  for (const [index, sourceId] of toCopy.entries()) {
    const source = library.hooks.find((hook) => hook.id === sourceId);
    if (!source || !isCompleteHook(source)) continue;

    const id = `hook-copy-${stamp}-${index}`;
    await addHook({
      ...source,
      id,
      campaignId: targetCampaignId,
      copiedFromHookId: source.id,
      copiedFromCampaignId: sourceCampaignId,
      createdAt: new Date().toISOString(),
    });
    copiedIds.push(id);
    if (!newHookIds.includes(id)) newHookIds.push(id);
  }

  if (!copiedIds.length) {
    throw new Error("Could not copy hooks from the source campaign.");
  }

  await updateCampaign(targetCampaignId, { hookIds: newHookIds });
  return copiedIds;
}
