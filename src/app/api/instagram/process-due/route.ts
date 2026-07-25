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

    const result = await processInstagramDue({ id: body.id });
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not process scheduled posts.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
