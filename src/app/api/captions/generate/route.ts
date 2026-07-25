import { NextResponse } from "next/server";
import { generateCaptionsFromLibrary } from "@/lib/gemini-captions";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      count?: number;
      theme?: string;
      saveToLibrary?: boolean;
    };

    const result = await generateCaptionsFromLibrary({
      count: body.count ?? 20,
      theme: body.theme,
      saveToLibrary: body.saveToLibrary ?? true,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[captions/generate]", err);
    const message =
      err instanceof Error ? err.message : "Caption generation failed.";
    const status = /GEMINI_API_KEY|at least 3 captions/i.test(message)
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
