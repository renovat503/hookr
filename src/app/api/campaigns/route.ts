import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  CAMPAIGN_COOKIE,
  campaignCookieOptions,
  clearSessionCookieOptions,
  isSecureRequest,
} from "@/lib/auth-session";
import { resolveActiveCampaign } from "@/lib/active-campaign";
import { usesPostgresRead } from "@/lib/config/storage-mode";
import { getDb } from "@/lib/db/client";
import { formatPgError } from "@/lib/db/connection-url";
import {
  scheduledPosts as scheduledPostsTable,
  youtubeScheduledPosts as youtubeScheduledPostsTable,
} from "@/lib/db/schema";
import {
  addCampaign,
  readCampaigns,
  removeCampaign,
} from "@/lib/campaign-store";
import { DEFAULT_MUSIC_VOLUME } from "@/lib/constants";
import type { CampaignAudioMode, CampaignBorrowAssetKind } from "@/lib/types";

export const runtime = "nodejs";

async function scheduledCountsByCampaign(
  campaignIds: string[],
): Promise<Record<string, { instagram: number; youtube: number; total: number }>> {
  const empty = Object.fromEntries(
    campaignIds.map((id) => [id, { instagram: 0, youtube: 0, total: 0 }]),
  ) as Record<string, { instagram: number; youtube: number; total: number }>;

  if (!campaignIds.length || !usesPostgresRead()) return empty;

  const db = getDb();
  const [igRows, ytRows] = await Promise.all([
    db
      .select({
        campaignId: scheduledPostsTable.campaignId,
        count: sql<number>`count(*)::int`,
      })
      .from(scheduledPostsTable)
      .where(
        and(
          inArray(scheduledPostsTable.campaignId, campaignIds),
          eq(scheduledPostsTable.status, "scheduled"),
        ),
      )
      .groupBy(scheduledPostsTable.campaignId),
    db
      .select({
        campaignId: youtubeScheduledPostsTable.campaignId,
        count: sql<number>`count(*)::int`,
      })
      .from(youtubeScheduledPostsTable)
      .where(
        and(
          inArray(youtubeScheduledPostsTable.campaignId, campaignIds),
          eq(youtubeScheduledPostsTable.status, "scheduled"),
        ),
      )
      .groupBy(youtubeScheduledPostsTable.campaignId),
  ]);

  for (const row of igRows) {
    if (!row.campaignId || !empty[row.campaignId]) continue;
    empty[row.campaignId].instagram = Number(row.count) || 0;
  }
  for (const row of ytRows) {
    if (!row.campaignId || !empty[row.campaignId]) continue;
    empty[row.campaignId].youtube = Number(row.count) || 0;
  }
  for (const id of campaignIds) {
    const entry = empty[id]!;
    entry.total = entry.instagram + entry.youtube;
  }
  return empty;
}

export async function GET() {
  try {
    const data = await readCampaigns();
    const activeCampaign = await resolveActiveCampaign();
    const counts = await scheduledCountsByCampaign(
      data.campaigns.map((campaign) => campaign.id),
    );
    return NextResponse.json({
      ...data,
      campaigns: data.campaigns.map((campaign) => ({
        ...campaign,
        scheduledCount: counts[campaign.id]?.total ?? 0,
        scheduledInstagram: counts[campaign.id]?.instagram ?? 0,
        scheduledYouTube: counts[campaign.id]?.youtube ?? 0,
      })),
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
