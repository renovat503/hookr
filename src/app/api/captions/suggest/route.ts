import { NextResponse } from "next/server";
import { suggestHookCaptions } from "@/lib/gemini-captions";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      count?: number;
      theme?: string;
    };

    const captions = await suggestHookCaptions({
      count: body.count ?? 5,
      theme: body.theme,
    });

    return NextResponse.json({ captions });
  } catch (err) {
    console.error("[captions/suggest]", err);
    const message =
      err instanceof Error ? err.message : "Caption generation failed.";
    const status = /GEMINI_API_KEY/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
