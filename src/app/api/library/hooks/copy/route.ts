import { NextResponse } from "next/server";
import { getActiveCampaignId } from "@/lib/active-campaign";
import { hooksOwnedByCampaign } from "@/lib/campaign-hooks";
import { getCampaign, updateCampaign } from "@/lib/campaign-store";
import { addHook, readLibrary } from "@/lib/library-store";
import { isCompleteHook } from "@/lib/utils";

export const runtime = "nodejs";

type CopyBody = {
  hookIds?: string[];
  sourceCampaignId?: string;
};

export async function POST(request: Request) {
  try {
    const targetCampaignId = await getActiveCampaignId();
    if (!targetCampaignId) {
      return NextResponse.json(
        { error: "Select an active campaign to copy hooks into." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as CopyBody;
    const sourceCampaignId = body.sourceCampaignId?.trim();
    const hookIds = body.hookIds?.filter(Boolean) ?? [];

    if (!sourceCampaignId) {
      return NextResponse.json(
        { error: "sourceCampaignId is required." },
        { status: 400 },
      );
    }
    if (!hookIds.length) {
      return NextResponse.json(
        { error: "Select at least one hook to copy." },
        { status: 400 },
      );
    }
    if (sourceCampaignId === targetCampaignId) {
      return NextResponse.json(
        { error: "Choose a different campaign to copy from." },
        { status: 400 },
      );
    }

    const [targetCampaign, sourceCampaign, library] = await Promise.all([
      getCampaign(targetCampaignId),
      getCampaign(sourceCampaignId),
      readLibrary(),
    ]);

    if (!targetCampaign) {
      return NextResponse.json(
        { error: "Active campaign not found." },
        { status: 404 },
      );
    }
    if (!sourceCampaign) {
      return NextResponse.json(
        { error: "Source campaign not found." },
        { status: 404 },
      );
    }
    if (
      targetCampaign.borrowAssetKind === "hooks" &&
      targetCampaign.borrowFromCampaignId
    ) {
      return NextResponse.json(
        {
          error:
            "This campaign reuses hooks from another campaign. Clear that link before copying hooks.",
        },
        { status: 400 },
      );
    }

    const sourceOwned = new Set(
      hooksOwnedByCampaign(sourceCampaignId, library).map((h) => h.id),
    );
    const toCopy = hookIds.filter((id) => sourceOwned.has(id));
    if (!toCopy.length) {
      return NextResponse.json(
        { error: "None of the selected hooks belong to the source campaign." },
        { status: 400 },
      );
    }

    const stamp = Date.now();
    const copiedIds: string[] = [];
    const newHookIds = [...targetCampaign.hookIds];

    for (const [index, sourceId] of toCopy.entries()) {
      const source = library.hooks.find((h) => h.id === sourceId);
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
      return NextResponse.json(
        { error: "Could not copy the selected hooks." },
        { status: 400 },
      );
    }

    await updateCampaign(targetCampaignId, { hookIds: newHookIds });

    return NextResponse.json({
      copiedIds,
      count: copiedIds.length,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not copy hooks.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
