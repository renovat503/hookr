import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  CAMPAIGN_COOKIE,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/auth-session";
import { getCampaign } from "@/lib/campaign-store";
import { formatPgError } from "@/lib/db/connection-url";

export async function GET() {
  try {
    const jar = await cookies();
    const session = jar.get(SESSION_COOKIE)?.value;
    if (!(await verifySessionToken(session))) {
      return NextResponse.json({ authenticated: false });
    }

    const activeId = jar.get(CAMPAIGN_COOKIE)?.value ?? null;
    const activeCampaign = activeId ? await getCampaign(activeId) : null;

    return NextResponse.json({
      authenticated: true,
      activeCampaign,
    });
  } catch (err) {
    console.error("[session] GET failed", err);
    return NextResponse.json(
      { authenticated: false, error: formatPgError(err) },
      { status: 503 },
    );
  }
}
