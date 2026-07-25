import { NextResponse } from "next/server";
import {
  ExportDuplicateError,
  exportLibraryVideo,
} from "@/lib/export-video";
import { removeExportReferences } from "@/lib/instagram-store";
import { deleteMedia } from "@/lib/storage/media";
import { readLibrary, removeLibraryItem } from "@/lib/library-store";
import type { OverlayStyle } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type ExportBody = {
  hookId?: string;
  demoId?: string;
  hookUrl?: string;
  demoUrl?: string;
  hookActionPrompt?: string;
  demoName?: string;
  overlayText?: string;
  overlayStyle?: Partial<OverlayStyle>;
  overlayPngBase64?: string | null;
  musicId?: string | null;
  musicUrl?: string | null;
  musicVolume?: number;
  runFolder?: string | null;
  sequence?: number;
  campaignId?: string | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExportBody;
    const exp = await exportLibraryVideo(body);
    return NextResponse.json(exp);
  } catch (err) {
    if (err instanceof ExportDuplicateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[library/exports]", err);
    const raw = err instanceof Error ? err.message : "Export failed.";
    const friendly =
      /Media file is missing|Could not download media/i.test(raw)
        ? "A hook or demo video is missing from cloud storage. Re-upload demos in Library → Demos (and ensure hooks are on Supabase), then try Produce again."
        : /No such filter|Error reinitializing filters|Conversion failed/i.test(raw)
          ? "Could not burn captions onto the video. Try a simpler caption, or re-apply the caption from Step 1, then export again."
          : raw.length > 280
            ? `${raw.slice(0, 280)}…`
            : raw;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }

    const library = await readLibrary();
    const exp = library.exports.find((e) => e.id === id);
    if (!exp) {
      return NextResponse.json({ error: "Finished video not found." }, { status: 404 });
    }

    await deleteMedia(exp.url);
    await removeLibraryItem("exports", id);
    await removeExportReferences(id);

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not delete finished video.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
