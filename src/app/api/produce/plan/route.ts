import { NextResponse } from "next/server";
import { readLibrary } from "@/lib/library-store";
import { readCaptions } from "@/lib/caption-store";
import { buildProduceCombos } from "@/lib/produce-combos";
import {
  mergeCampaignAssets,
  ownedCampaignAssetPatch,
} from "@/lib/campaign-assets";
import { getCampaign, readCampaigns, updateCampaign } from "@/lib/campaign-store";
import { isCampaignClosed } from "@/lib/campaign-status";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      campaignId?: string;
      hookIds?: string[];
      demoIds?: string[];
      captionIds?: string[];
      noCaptions?: boolean;
      shuffle?: boolean;
      maxCount?: number;
    };

    const library = await readLibrary("pickers");
    const captions = await readCaptions();
    const allCampaigns = (await readCampaigns()).campaigns;

    let hookIds = body.hookIds;
    let demoIds = body.demoIds;
    let campaign = body.campaignId
      ? await getCampaign(body.campaignId)
      : null;

    if (campaign) {
      if (isCampaignClosed(campaign)) {
        return NextResponse.json(
          { error: "This campaign is closed. Reopen it in settings to produce videos." },
          { status: 400 },
        );
      }
      const merged = mergeCampaignAssets(campaign, library, allCampaigns);
      const assetPatch = ownedCampaignAssetPatch(campaign, merged);
      if (assetPatch) {
        campaign = await updateCampaign(campaign.id, assetPatch);
      }
      hookIds = merged.hookIds;
      demoIds = merged.demoIds;
    }

    let captionTexts: string[];
    if (body.noCaptions) {
      captionTexts = [""];
    } else if (body.captionIds?.length) {
      captionTexts = captions
        .filter((c) => body.captionIds!.includes(c.id))
        .map((c) => c.text);
    } else {
      captionTexts = captions.map((c) => c.text);
    }

    const combos = buildProduceCombos(library, {
      hookIds,
      demoIds,
      captions: captionTexts,
      musicIds: [null],
      shuffle: body.shuffle ?? true,
      maxCount: body.maxCount,
    });

    return NextResponse.json({
      combos,
      total: combos.length,
      hooks: hookIds?.length ?? 0,
      demos: demoIds?.length ?? 0,
      captions: captionTexts.length,
      campaign,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not plan production run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
