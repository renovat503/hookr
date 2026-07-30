import { NextResponse } from "next/server";
import { getActiveCampaignId } from "@/lib/active-campaign";
import {
  parseLibraryScope,
  readLibrary,
} from "@/lib/library-store";
import { formatPgError } from "@/lib/db/connection-url";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const scope = parseLibraryScope(params.get("scope"));
    let campaignId = params.get("campaignId")?.trim() || null;
    if (scope === "exports" && !campaignId) {
      campaignId = await getActiveCampaignId();
    }
    const library = await readLibrary(scope, { campaignId });
    return NextResponse.json(library);
  } catch (err) {
    console.error("[library] GET failed", err);
    return NextResponse.json(
      { error: formatPgError(err) },
      { status: 503 },
    );
  }
}
