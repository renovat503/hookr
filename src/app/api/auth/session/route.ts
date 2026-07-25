import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { CAMPAIGN_COOKIE, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { readCampaigns, getActiveCampaign } from "@/lib/campaign-store";

export async function GET() {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(session)) {
    return NextResponse.json({ authenticated: false });
  }

  const activeId = jar.get(CAMPAIGN_COOKIE)?.value ?? null;
  const data = await readCampaigns();
  const active = activeId
    ? data.campaigns.find((c) => c.id === activeId) ?? null
    : null;

  return NextResponse.json({
    authenticated: true,
    activeCampaign: active ?? (await getActiveCampaign(activeId)),
  });
}
