import path from "path";
import { mkdir } from "fs/promises";
import { NextResponse } from "next/server";
import { addHook, readLibrary } from "@/lib/library-store";
import { appendAssetToActiveCampaign } from "@/lib/sync-campaign-assets";
import { requireActiveCampaignId } from "@/lib/active-campaign";
import { burnTextOverlay, hookrTmpDir, safeUnlink } from "@/lib/ffmpeg";
import { resolveHookRawPath } from "@/lib/hook-raw";
import { mergeOverlayStyle } from "@/lib/overlay-style";
import { resolveToLocalPath, saveMediaFromLocalPath } from "@/lib/storage/media";
import type { CharacterSource, OverlayStyle } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  motionId?: string;
  hookId?: string;
  overlayText?: string;
  overlayStyle?: Partial<OverlayStyle>;
  overlayPngBase64?: string | null;
  actionPrompt?: string;
  referenceMotionId?: string | null;
  characterSource?: CharacterSource;
  characterPresetId?: string | null;
};

export async function POST(request: Request) {
  let burnedTempPath: string | null = null;

  try {
    const body = (await request.json()) as Body;
    const motionId = body.motionId?.trim();
    const hookId = body.hookId?.trim();
    const overlayText = body.overlayText?.trim() ?? "";

    if (!motionId && !hookId) {
      return NextResponse.json(
        { error: "motionId or hookId is required." },
        { status: 400 },
      );
    }
    if (!overlayText) {
      return NextResponse.json(
        { error: "Enter overlay text to apply." },
        { status: 400 },
      );
    }

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

    if (!body.overlayPngBase64?.trim()) {
      return NextResponse.json(
        { error: "Caption image missing — refresh the page and try again." },
        { status: 400 },
      );
    }

    const data = await readLibrary("assets");
    const overlayStyle = mergeOverlayStyle(body.overlayStyle);
    const stamp = Date.now();
    const newHookId = `hook-${stamp}`;
    const tmpDir = hookrTmpDir();
    await mkdir(tmpDir, { recursive: true });
    burnedTempPath = path.join(tmpDir, `${newHookId}.mp4`);

    let rawUrl: string;
    let actionPrompt: string;
    let durationSeconds: number;
    let referenceMotionId: string | null = body.referenceMotionId ?? null;
    let characterSource: CharacterSource = body.characterSource ?? "upload";
    let characterPresetId: string | null = body.characterPresetId ?? null;

    if (motionId) {
      const motion = data.motions.find((m) => m.id === motionId);
      if (!motion) {
        return NextResponse.json({ error: "Motion not found." }, { status: 404 });
      }

      await burnTextOverlay({
        inputPath: await resolveToLocalPath(motion.url),
        outputPath: burnedTempPath,
        text: overlayText,
        style: overlayStyle,
        overlayPngBase64: body.overlayPngBase64,
      });

      rawUrl = motion.url;
      actionPrompt = body.actionPrompt?.trim() || motion.actionPrompt;
      durationSeconds = motion.durationSeconds || 4;
    } else {
      const hook = data.hooks.find((h) => h.id === hookId);
      if (!hook) {
        return NextResponse.json({ error: "Hook not found." }, { status: 404 });
      }

      const resolved = await resolveHookRawPath(hook);
      await burnTextOverlay({
        inputPath: resolved.path,
        outputPath: burnedTempPath,
        text: overlayText,
        style: overlayStyle,
        overlayPngBase64: body.overlayPngBase64,
      });

      rawUrl = resolved.rawUrl;
      actionPrompt = hook.actionPrompt;
      durationSeconds = hook.durationSeconds;
      referenceMotionId = hook.referenceMotionId ?? referenceMotionId;
      characterSource =
        hook.characterSource === "library" ? "upload" : hook.characterSource;
      characterPresetId = hook.characterPresetId;
    }

    const burnedUrl = await saveMediaFromLocalPath({
      storageKey: `generated/${newHookId}.mp4`,
      localPath: burnedTempPath,
      contentType: "video/mp4",
    });

    const hook = await addHook({
      id: newHookId,
      url: burnedUrl,
      rawUrl,
      actionPrompt,
      overlayText,
      overlayStyle,
      characterSource,
      characterPresetId,
      durationSeconds,
      overlayBurned: true,
      referenceMotionId,
      campaignId,
      createdAt: new Date().toISOString(),
    });

    await appendAssetToActiveCampaign("hooks", newHookId);

    return NextResponse.json(hook);
  } catch (err) {
    console.error("[hooks/apply-overlay]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not apply caption." },
      { status: 500 },
    );
  } finally {
    if (burnedTempPath) await safeUnlink(burnedTempPath);
  }
}
