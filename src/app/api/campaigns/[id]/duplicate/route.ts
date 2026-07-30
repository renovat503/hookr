import { NextResponse } from "next/server";
import {
  CAMPAIGN_COOKIE,
  campaignCookieOptions,
  isSecureRequest,
} from "@/lib/auth-session";
import { duplicateCampaign } from "@/lib/campaign-store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const campaign = await duplicateCampaign(id, body.name);
    const secure = isSecureRequest(request);
    const res = NextResponse.json(campaign, { status: 201 });
    res.cookies.set(CAMPAIGN_COOKIE, campaign.id, campaignCookieOptions(secure));
    return res;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not duplicate campaign.";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
