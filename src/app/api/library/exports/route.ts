import { NextResponse } from "next/server";
import { getActiveCampaignId } from "@/lib/active-campaign";
import {
  ExportDuplicateError,
  exportLibraryVideo,
} from "@/lib/export-video";
import { removeExportReferences } from "@/lib/instagram-store";
import { deleteMedia } from "@/lib/storage/media";
import { readLibrary, removeLibraryItem } from "@/lib/library-store";
import { removeYouTubeExportReferences } from "@/lib/youtube-store";
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

async function deleteExportById(
  id: string,
  campaignId: string | null,
): Promise<{ id: string } | { error: string; status: number }> {
  const library = await readLibrary("exports", { campaignId });
  const exp = library.exports.find((e) => e.id === id);
  if (!exp) {
    return { error: "Finished video not found.", status: 404 };
  }
  if (campaignId && exp.campaignId && exp.campaignId !== campaignId) {
    return {
      error: "That finished video belongs to a different campaign.",
      status: 403,
    };
  }

  await deleteMedia(exp.url);
  await removeLibraryItem("exports", id);
  // Soft-cancel schedules; keep rows for recovery. Do not hard-delete schedule history.
  await removeExportReferences(id);
  await removeYouTubeExportReferences(id);

  return { id };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExportBody;
    const campaignId = body.campaignId ?? (await getActiveCampaignId());
    const exp = await exportLibraryVideo({ ...body, campaignId });
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
    const campaignId = await getActiveCampaignId();
    const { searchParams } = new URL(request.url);
    const singleId = searchParams.get("id")?.trim();

    let ids: string[] = [];
    if (singleId) {
      ids = [singleId];
    } else {
      const body = (await request.json().catch(() => ({}))) as {
        ids?: unknown;
      };
      if (Array.isArray(body.ids)) {
        ids = body.ids
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean);
      }
    }

    ids = [...new Set(ids)];
    if (!ids.length) {
      return NextResponse.json(
        { error: "Provide id or ids of finished videos to delete." },
        { status: 400 },
      );
    }
    if (!campaignId) {
      return NextResponse.json(
        { error: "Select a campaign before deleting finished videos." },
        { status: 400 },
      );
    }
    if (ids.length > 100) {
      return NextResponse.json(
        { error: "Delete up to 100 finished videos at a time." },
        { status: 400 },
      );
    }

    const deleted: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
      const result = await deleteExportById(id, campaignId);
      if ("error" in result) {
        errors.push({ id, error: result.error });
        continue;
      }
      deleted.push(result.id);
    }

    if (!deleted.length) {
      return NextResponse.json(
        {
          error: errors[0]?.error || "Could not delete finished videos.",
          errors,
        },
        { status: errors[0]?.status === 403 ? 403 : 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      deleted,
      deletedCount: deleted.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not delete finished video.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
