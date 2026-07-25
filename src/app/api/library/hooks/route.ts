import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { NextResponse } from "next/server";
import { addHook, readLibrary, removeLibraryItem } from "@/lib/library-store";
import { appendAssetToActiveCampaign } from "@/lib/sync-campaign-assets";
import { requireActiveCampaignId } from "@/lib/active-campaign";
import { burnTextOverlay, safeUnlink } from "@/lib/ffmpeg";
import { DEFAULT_OVERLAY_STYLE } from "@/lib/constants";
import { mergeOverlayStyle } from "@/lib/overlay-style";
import {
  deleteMedia,
  guessVideoContentType,
  saveMediaBuffer,
  saveMediaFromLocalPath,
} from "@/lib/storage/media";
import type { OverlayStyle } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let rawTempPath: string | null = null;
  let burnedTempPath: string | null = null;

  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No video file provided." }, { status: 400 });
    }

    if (!file.type.startsWith("video/")) {
      return NextResponse.json(
        { error: "Please upload a video file (MP4, MOV, etc.)." },
        { status: 400 },
      );
    }

    const overlayRaw = form.get("overlayText");
    const overlayText =
      typeof overlayRaw === "string" ? overlayRaw.trim() : "";

    let overlayStyle: OverlayStyle = DEFAULT_OVERLAY_STYLE;
    const styleRaw = form.get("overlayStyle");
    if (typeof styleRaw === "string" && styleRaw.trim()) {
      try {
        overlayStyle = mergeOverlayStyle(JSON.parse(styleRaw) as Partial<OverlayStyle>);
      } catch {
        overlayStyle = DEFAULT_OVERLAY_STYLE;
      }
    }

    const ext = path.extname(file.name) || ".mp4";
    const id = `hook-upload-${Date.now()}`;
    const filename = `${id}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || guessVideoContentType(filename);
    let rawUrl: string | null = null;
    let publicUrl: string;

    if (overlayText) {
      const tmpDir = path.join(process.cwd(), "tmp");
      await mkdir(tmpDir, { recursive: true });
      rawTempPath = path.join(tmpDir, `${id}-raw${ext}`);
      burnedTempPath = path.join(tmpDir, filename);
      await writeFile(rawTempPath, buffer);
      await burnTextOverlay({
        inputPath: rawTempPath,
        outputPath: burnedTempPath,
        text: overlayText,
        style: overlayStyle,
      });
      rawUrl = await saveMediaFromLocalPath({
        storageKey: `uploads/hooks/${id}-raw${ext}`,
        localPath: rawTempPath,
        contentType,
      });
      publicUrl = await saveMediaFromLocalPath({
        storageKey: `uploads/hooks/${filename}`,
        localPath: burnedTempPath,
        contentType,
      });
    } else {
      publicUrl = await saveMediaBuffer({
        storageKey: `uploads/hooks/${filename}`,
        buffer,
        contentType,
      });
    }

    const durationRaw = form.get("durationSeconds");
    const durationSeconds =
      typeof durationRaw === "string" && durationRaw
        ? Math.max(1, Math.round(Number(durationRaw)))
        : 4;

    const label = file.name.replace(/\.[^/.]+$/, "").trim() || "Uploaded hook";

    let campaignId: string;
    try {
      campaignId = await requireActiveCampaignId();
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Select an active campaign before uploading hooks.",
        },
        { status: 400 },
      );
    }

    const hook = await addHook({
      id,
      url: publicUrl,
      rawUrl,
      actionPrompt: label,
      overlayText,
      overlayStyle: overlayText ? overlayStyle : undefined,
      characterSource: "upload",
      characterPresetId: null,
      durationSeconds,
      overlayBurned: true,
      campaignId,
      createdAt: new Date().toISOString(),
    });

    await appendAssetToActiveCampaign("hooks", id);

    return NextResponse.json(hook);
  } catch (err) {
    console.error("[library/hooks POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 500 },
    );
  } finally {
    if (rawTempPath) await safeUnlink(rawTempPath);
    if (burnedTempPath) await safeUnlink(burnedTempPath);
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }

    const library = await readLibrary();
    const hook = library.hooks.find((item) => item.id === id);
    if (!hook) {
      return NextResponse.json({ error: "Hook not found." }, { status: 404 });
    }

    await deleteMedia(hook.url);
    if (hook.rawUrl && hook.rawUrl !== hook.url) {
      await deleteMedia(hook.rawUrl);
    }
    await removeLibraryItem("hooks", id);

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not delete hook.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
