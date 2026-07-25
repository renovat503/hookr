import path from "path";
import { mkdir } from "fs/promises";
import { NextResponse } from "next/server";
import { addHook, readLibrary, updateHook } from "@/lib/library-store";
import { appendAssetToActiveCampaign } from "@/lib/sync-campaign-assets";
import { requireActiveCampaignId } from "@/lib/active-campaign";
import { burnTextOverlay, safeUnlink } from "@/lib/ffmpeg";
import { ensureRawCopy, resolveHookRawPath } from "@/lib/hook-raw";
import { mergeOverlayStyle } from "@/lib/overlay-style";
import { saveMediaFromLocalPath } from "@/lib/storage/media";
import type { OverlayStyle } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  sourceHookId?: string;
  overlayText?: string;
  overlayStyle?: Partial<OverlayStyle>;
  overlayPngBase64?: string | null;
};

export async function POST(request: Request) {
  let outTempPath: string | null = null;

  try {
    const body = (await request.json()) as Body;
    const overlayText = body.overlayText?.trim() ?? "";

    if (!body.sourceHookId) {
      return NextResponse.json(
        { error: "sourceHookId is required." },
        { status: 400 },
      );
    }
    if (!overlayText) {
      return NextResponse.json(
        { error: "Enter new overlay text to apply." },
        { status: 400 },
      );
    }

    const data = await readLibrary();
    const source = data.hooks.find((h) => h.id === body.sourceHookId);
    if (!source) {
      return NextResponse.json({ error: "Hook not found." }, { status: 404 });
    }

    const overlayStyle = mergeOverlayStyle({
      ...source.overlayStyle,
      ...body.overlayStyle,
    });

    const resolved = await resolveHookRawPath(source);

    if (!source.rawUrl && resolved.isTrueRaw) {
      source.rawUrl = resolved.rawUrl;
      await updateHook(source);
    }

    const stamp = Date.now();
    const id = `hook-${stamp}`;
    const tmpDir = path.join(process.cwd(), "tmp");
    await mkdir(tmpDir, { recursive: true });
    outTempPath = path.join(tmpDir, `${id}.mp4`);

    const rawUrl = resolved.isTrueRaw
      ? resolved.rawUrl
      : await ensureRawCopy(resolved.path, `/generated/${id}-raw.mp4`);

    await burnTextOverlay({
      inputPath: resolved.path,
      outputPath: outTempPath,
      text: overlayText,
      style: overlayStyle,
      overlayPngBase64: body.overlayPngBase64,
    });

    const publicUrl = await saveMediaFromLocalPath({
      storageKey: `generated/${id}.mp4`,
      localPath: outTempPath,
      contentType: "video/mp4",
    });

    const characterSource =
      source.characterSource === "library" ? "upload" : source.characterSource;

    let campaignId: string;
    try {
      campaignId = await requireActiveCampaignId();
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Select an active campaign before saving hooks.",
        },
        { status: 400 },
      );
    }

    const hook = await addHook({
      id,
      url: publicUrl,
      rawUrl,
      actionPrompt: source.actionPrompt,
      overlayText,
      overlayStyle,
      characterSource,
      characterPresetId: source.characterPresetId,
      durationSeconds: source.durationSeconds,
      overlayBurned: true,
      sourceHookId: source.id,
      campaignId,
      createdAt: new Date().toISOString(),
    });

    await appendAssetToActiveCampaign("hooks", id);

    return NextResponse.json({
      ...hook,
      fromRaw: resolved.isTrueRaw,
      warning: resolved.isTrueRaw
        ? undefined
        : "No caption-free source was found, so text was applied on top of the existing video.",
    });
  } catch (err) {
    console.error("[hooks/recaption]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Recaption failed." },
      { status: 500 },
    );
  } finally {
    if (outTempPath) await safeUnlink(outTempPath);
  }
}
