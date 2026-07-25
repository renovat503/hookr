import { NextResponse } from "next/server";
import { processInstagramDue } from "@/lib/process-instagram-due";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Publish due scheduled posts, then run auto-post for eligible accounts. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      force?: boolean;
    };

    void processInstagramDue({ id: body.id }).catch((err) => {
      console.error("[instagram/process-due]", err);
    });

    return NextResponse.json({ accepted: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not process scheduled posts.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
