import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  CAMPAIGN_COOKIE,
  campaignCookieOptions,
  clearSessionCookieOptions,
  isSecureRequest,
} from "@/lib/auth-session";
import {
  addCampaign,
  readCampaigns,
  removeCampaign,
} from "@/lib/campaign-store";
import { DEFAULT_MUSIC_VOLUME } from "@/lib/constants";
import type { CampaignAudioMode, CampaignBorrowAssetKind } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const data = await readCampaigns();
  const jar = await cookies();
  const activeId = jar.get(CAMPAIGN_COOKIE)?.value ?? null;
  return NextResponse.json({ ...data, activeId });
}

export async function POST(request: Request) {
  try {
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
      activate?: boolean;
      borrowFromCampaignId?: string;
      borrowAssetKind?: CampaignBorrowAssetKind;
    };

    let hookIds = body.hookIds ?? [];
    let demoIds = body.demoIds ?? [];
    let captionIds = body.captionIds ?? [];
    let useCaptions = Boolean(body.useCaptions);
    let audioMode: CampaignAudioMode = body.audioMode ?? "none";
    let musicId = body.musicId ?? null;
    let musicVolume = body.musicVolume ?? DEFAULT_MUSIC_VOLUME;
    let randomFormat = body.randomFormat !== false;
    let borrowFromCampaignId: string | null = null;
    let borrowAssetKind: CampaignBorrowAssetKind | null = null;

    if (body.borrowFromCampaignId) {
      const data = await readCampaigns();
      const source = data.campaigns.find(
        (c) => c.id === body.borrowFromCampaignId,
      );
      if (!source) {
        return NextResponse.json(
          { error: "Source campaign not found." },
          { status: 400 },
        );
      }
      if (!body.borrowAssetKind) {
        return NextResponse.json(
          { error: "Choose whether to reuse hooks or demos from the source campaign." },
          { status: 400 },
        );
      }
      borrowFromCampaignId = source.id;
      borrowAssetKind = body.borrowAssetKind;
      // Only link one asset type — the other side stays empty for this campaign.
      hookIds = [];
      demoIds = [];
    }

    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "Campaign name is required." }, { status: 400 });
    }

    const campaign = await addCampaign({
      name,
      status: "open",
      hookIds,
      demoIds,
      captionIds,
      useCaptions,
      audioMode,
      musicId: audioMode === "none" ? null : musicId,
      musicVolume,
      randomFormat,
      borrowFromCampaignId,
      borrowAssetKind,
    });

    const secure = isSecureRequest(request);
    const res = NextResponse.json(campaign, { status: 201 });

    if (body.activate !== false) {
      res.cookies.set(CAMPAIGN_COOKIE, campaign.id, campaignCookieOptions(secure));
    }

    return res;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not create campaign.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const ok = await removeCampaign(id);
  if (!ok) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  const jar = await cookies();
  if (jar.get(CAMPAIGN_COOKIE)?.value === id) {
    const secure = isSecureRequest(request);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(CAMPAIGN_COOKIE, "", { ...clearSessionCookieOptions(secure), maxAge: 0 });
    return res;
  }
  return NextResponse.json({ ok: true });
}
