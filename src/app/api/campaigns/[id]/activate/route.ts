import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { CAMPAIGN_COOKIE, campaignCookieOptions } from "@/lib/auth";
import { getCampaign } from "@/lib/campaign-store";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const secure = new URL(_request.url).protocol === "https:";
  const res = NextResponse.json({ ok: true, campaign });
  res.cookies.set(CAMPAIGN_COOKIE, id, campaignCookieOptions(secure));
  return res;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  return NextResponse.json(campaign);
}
