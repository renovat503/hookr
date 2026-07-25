import { NextResponse } from "next/server";
import {
  addCaptions,
  importCaptionLines,
  readCaptions,
  removeCaption,
  updateCaption,
} from "@/lib/caption-store";
import { DEFAULT_TEXT_OVERLAYS } from "@/lib/constants";

export const runtime = "nodejs";

async function ensureSeededCaptions() {
  const existing = await readCaptions();
  if (existing.length) return existing;
  await addCaptions(DEFAULT_TEXT_OVERLAYS);
  return readCaptions();
}

export async function GET() {
  try {
    const captions = await ensureSeededCaptions();
    return NextResponse.json({ captions, count: captions.length });
  } catch (err) {
    console.error("[captions] GET failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load captions." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      texts?: string[];
      import?: string;
      tags?: string[];
    };

    if (typeof body.import === "string") {
      const result = await importCaptionLines(body.import);
      return NextResponse.json({
        captions: result.added,
        added: result.added.length,
        skipped: result.skipped,
      });
    }

    const texts = Array.isArray(body.texts) ? body.texts : [];
    if (!texts.length) {
      return NextResponse.json(
        { error: "Provide texts[] or import string." },
        { status: 400 },
      );
    }

    const added = await addCaptions(texts, body.tags ?? []);
    return NextResponse.json({ captions: added, added: added.length });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not save captions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const ok = await removeCaption(id);
  if (!ok) {
    return NextResponse.json({ error: "Caption not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { id?: string; text?: string };
    const id = body.id?.trim();
    const text = body.text?.trim() ?? "";

    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json(
        { error: "Caption text cannot be empty." },
        { status: 400 },
      );
    }

    const updated = await updateCaption(id, text);
    if (!updated) {
      return NextResponse.json({ error: "Caption not found." }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not update caption.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
