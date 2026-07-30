import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Hook copying is only available via campaign duplicate. */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Copying hooks from another campaign is disabled. Duplicate a campaign instead.",
    },
    { status: 403 },
  );
}
