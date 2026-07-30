import { NextResponse } from "next/server";
import { processYouTubeDue } from "@/lib/process-youtube-due";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: string };

    void processYouTubeDue({ id: body.id }).catch((err) => {
      console.error("[youtube/process-due]", err);
    });

    return NextResponse.json({ accepted: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not process scheduled posts.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
