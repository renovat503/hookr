import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  CAMPAIGN_COOKIE,
  campaignCookieOptions,
  clearSessionCookieOptions,
  isSecureRequest,
} from "@/lib/auth-session";
import { resolveActiveCampaign } from "@/lib/active-campaign";
import { formatPgError } from "@/lib/db/connection-url";
import {
  addCampaign,
  readCampaigns,
  removeCampaign,
} from "@/lib/campaign-store";
import { DEFAULT_MUSIC_VOLUME } from "@/lib/constants";
import type { CampaignAudioMode, CampaignBorrowAssetKind } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await readCampaigns();
    const activeCampaign = await resolveActiveCampaign();
    return NextResponse.json({
      ...data,
      activeId: activeCampaign?.id ?? null,
      activeCampaign,
    });
  } catch (err) {
    console.error("[campaigns] GET failed", err);
    const message = formatPgError(err);
    return NextResponse.json({ error: message, campaigns: [] }, { status: 503 });
  }
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
    const audioMode: CampaignAudioMode = body.audioMode ?? "none";
    const musicId = body.musicId ?? null;
    const musicVolume = body.musicVolume ?? DEFAULT_MUSIC_VOLUME;
    const randomFormat = body.randomFormat !== false;

    if (body.borrowFromCampaignId || body.borrowAssetKind) {
      return NextResponse.json(
        {
          error:
            "Reusing hooks or demos from another campaign is disabled. Duplicate a campaign instead.",
        },
        { status: 400 },
      );
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
      captionIds: [],
      useCaptions: false,
      audioMode,
      musicId: audioMode === "none" ? null : musicId,
      musicVolume,
      randomFormat,
      borrowFromCampaignId: null,
      borrowAssetKind: null,
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
