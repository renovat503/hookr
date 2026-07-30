import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth-session";
import { resolveActiveCampaign } from "@/lib/active-campaign";
import { formatPgError } from "@/lib/db/connection-url";

export async function GET() {
  try {
    const jar = await cookies();
    const session = jar.get(SESSION_COOKIE)?.value;
    if (!(await verifySessionToken(session))) {
      return NextResponse.json({ authenticated: false });
    }

    const activeCampaign = await resolveActiveCampaign();

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
