import { NextResponse } from "next/server";
import { getCampaign, readCampaigns, updateCampaign } from "@/lib/campaign-store";
import type { CampaignAudioMode, CampaignBorrowAssetKind, CampaignStatus } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  return NextResponse.json(campaign);
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      hookIds?: string[];
      demoIds?: string[];
      captionIds?: string[];
      useCaptions?: boolean;
      audioMode?: CampaignAudioMode;
      musicId?: string | null;
      musicVolume?: number;
      randomFormat?: boolean;
      borrowFromCampaignId?: string | null;
      borrowAssetKind?: CampaignBorrowAssetKind | null;
      status?: CampaignStatus;
    };

    const existing = await getCampaign(id);
    if (!existing) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const useCaptions =
      body.useCaptions !== undefined ? body.useCaptions : existing.useCaptions;
    const captionIds = body.captionIds ?? existing.captionIds;
    const audioMode = body.audioMode ?? existing.audioMode;
    const musicId =
      body.musicId !== undefined
        ? body.musicId
        : audioMode === "none"
          ? null
          : existing.musicId;

    if (useCaptions && captionIds.length === 0) {
      return NextResponse.json(
        { error: "Select captions or turn off on-video captions." },
        { status: 400 },
      );
    }
    if (audioMode === "fixed" && !musicId) {
      return NextResponse.json(
        { error: "Pick a music track for fixed audio mode." },
        { status: 400 },
      );
    }

    const borrowFromCampaignId =
      body.borrowFromCampaignId !== undefined
        ? body.borrowFromCampaignId
        : existing.borrowFromCampaignId ?? null;
    const borrowAssetKind =
      body.borrowAssetKind !== undefined
        ? body.borrowAssetKind
        : existing.borrowAssetKind ?? null;

    if (borrowFromCampaignId && !borrowAssetKind) {
      return NextResponse.json(
        { error: "Choose whether to reuse hooks or demos from the linked campaign." },
        { status: 400 },
      );
    }
    if (borrowAssetKind && !borrowFromCampaignId) {
      return NextResponse.json(
        { error: "Select a campaign to reuse hooks or demos from." },
        { status: 400 },
      );
    }
    if (borrowFromCampaignId) {
      if (borrowFromCampaignId === id) {
        return NextResponse.json(
          { error: "A campaign cannot reuse assets from itself." },
          { status: 400 },
        );
      }
      const all = await readCampaigns();
      const source = all.campaigns.find((c) => c.id === borrowFromCampaignId);
      if (!source) {
        return NextResponse.json(
          { error: "Linked campaign not found." },
          { status: 400 },
        );
      }
    }

    const updated = await updateCampaign(id, {
      ...body,
      captionIds: useCaptions ? captionIds : [],
      useCaptions,
      audioMode,
      musicId: audioMode === "none" ? null : musicId,
      borrowFromCampaignId,
      borrowAssetKind,
    });

    if (!updated) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not update campaign.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
