import { mkdir, copyFile, readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { readLibrary } from "@/lib/library-store";
import { readAppSettings } from "@/lib/app-settings-store";
import {
  normalizeToReelFrame,
  safeUnlink,
  stripAudioFromVideo,
  writeTempBuffer,
} from "@/lib/ffmpeg";
import { resolveToLocalPath } from "@/lib/storage/media";
import { parseVideoModelRequest, isKlingModel } from "@/lib/video-models";
import {
  buildHookPrompt,
  describeMotionFromReferenceVideo,
  formatGeminiError,
  generateHookVideo,
  getGeminiClient,
  resolveHookModel,
} from "@/lib/gemini";
import { formatKlingError, generateKlingHookVideo } from "@/lib/kling";
import { publishKlingReferenceImage } from "@/lib/kling-media";
import { saveMotionFromBuffer } from "@/lib/save-motion";

export const runtime = "nodejs";
export const maxDuration = 300;

type GenerateBody = {
  actionPrompt?: string;
  characterSource?: "upload" | "preset";
  characterPresetId?: string | null;
  /** Past library motion clip to match motion/action from */
  referenceMotionId?: string | null;
  /** Base64 image bytes without data-URL prefix */
  imageBase64?: string | null;
  imageMimeType?: string | null;
  /** Display tagline for text-only fallback, e.g. "Bold storyteller" */
  characterTagline?: string | null;
  /** User-selected video model; "auto" or omitted uses server default routing */
  videoModel?: string | null;
};

export async function POST(request: Request) {
  let rawTempPath: string | null = null;
  let usedKlingProvider = false;

  try {
    const body = (await request.json()) as GenerateBody;
    const appSettings = await readAppSettings();
    const referenceMotionId =
      body.referenceMotionId?.trim() ||
      appSettings.referenceMotionId?.trim() ||
      null;
    const requestedModel =
      parseVideoModelRequest(body.videoModel) ?? resolveHookModel();
    const useKling = isKlingModel(requestedModel);
    usedKlingProvider = useKling;
    const needsGeminiMotion = Boolean(referenceMotionId);

    if (useKling && !process.env.KLING_API_KEY?.trim()) {
      return NextResponse.json(
        {
          error:
            "KLING_API_KEY is not set. Add it to .env.local from kling.ai/dev/api-key.",
        },
        { status: 503 },
      );
    }

    if ((!useKling || needsGeminiMotion) && !process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY is not set. Copy .env.local.example to .env.local and add your key.",
        },
        { status: 503 },
      );
    }

    const characterSource = body.characterSource ?? "upload";

    let actionPrompt = body.actionPrompt?.trim() ?? "";
    let matchReferenceMotion = false;

    if (referenceMotionId) {
      const library = await readLibrary();
      const referenceMotion = library.motions.find(
        (m) => m.id === referenceMotionId,
      );
      if (!referenceMotion) {
        return NextResponse.json(
          { error: "Reference motion not found in your library." },
          { status: 404 },
        );
      }

      if (referenceMotion.actionPrompt?.trim()) {
        actionPrompt = (
          body.actionPrompt?.trim() || referenceMotion.actionPrompt
        ).trim();
        matchReferenceMotion = true;
      } else {
        const motionPath = await resolveToLocalPath(referenceMotion.url);
        const videoBuffer = await readFile(motionPath);
        const ext = path.extname(motionPath).toLowerCase();
        const analyzed = await describeMotionFromReferenceVideo({
          videoBase64: videoBuffer.toString("base64"),
          videoMimeType: ext === ".mov" ? "video/quicktime" : "video/mp4",
        });
        actionPrompt = (body.actionPrompt?.trim() || analyzed).trim();
        matchReferenceMotion = true;
      }
    }

    if (!actionPrompt) {
      return NextResponse.json(
        {
          error:
            "actionPrompt is required (or upload / select a reference hook).",
        },
        { status: 400 },
      );
    }

    if (characterSource === "upload" && !body.imageBase64) {
      return NextResponse.json(
        { error: "Select or upload a character photo before generating." },
        { status: 400 },
      );
    }

    if (characterSource === "preset" && !body.characterPresetId) {
      return NextResponse.json(
        { error: "Select a character preset before generating." },
        { status: 400 },
      );
    }

    if (matchReferenceMotion && characterSource === "upload" && !body.imageBase64) {
      return NextResponse.json(
        {
          error:
            "Upload a character image to animate with reference hook motion.",
        },
        { status: 400 },
      );
    }

    const taglineHint = body.characterTagline?.trim() || null;
    const hasImage = Boolean(body.imageBase64?.trim());

    const prompt = buildHookPrompt({
      actionPrompt,
      characterSource: hasImage ? "upload" : characterSource,
      characterPresetId: null,
      matchReferenceMotion,
      hasReferenceImage: hasImage,
      taglineHint,
    });

    const textOnlyPrompt = buildHookPrompt({
      actionPrompt,
      characterSource: "upload",
      characterPresetId: null,
      matchReferenceMotion,
      hasReferenceImage: false,
      taglineHint,
    });

    const ai = useKling ? null : getGeminiClient();
    const hookModel = requestedModel;
    const stamp = Date.now();
    const tempDownloadPath = path.join(
      process.cwd(),
      "tmp",
      `hook-raw-${stamp}.mp4`,
    );
    await mkdir(path.dirname(tempDownloadPath), { recursive: true });

    let videoBytes: Buffer;
    let usedModel: string;
    let usedReferenceImage: boolean;
    let fallbackNote: string | null = null;

    if (useKling) {
      const imagePublicUrl = body.imageBase64?.trim()
        ? await publishKlingReferenceImage({
            imageBase64: body.imageBase64.trim(),
            mimeType: body.imageMimeType,
            stamp,
          })
        : null;

      const klingResult = await generateKlingHookVideo({
        prompt,
        model: hookModel,
        imageBase64: body.imageBase64,
        imagePublicUrl,
      });
      videoBytes = klingResult.videoBytes;
      usedModel = klingResult.model;
      usedReferenceImage = klingResult.usedReferenceImage;
    } else {
      const geminiResult = await generateHookVideo(ai!, {
        prompt,
        textOnlyPrompt,
        imageBase64: body.imageBase64,
        imageMimeType: body.imageMimeType,
        tempDownloadPath,
        model: hookModel,
      });
      videoBytes = geminiResult.videoBytes;
      usedModel = geminiResult.model;
      usedReferenceImage = geminiResult.usedReferenceImage;
      fallbackNote = geminiResult.fallbackNote ?? null;
    }

    const tempRawPath = path.join(
      process.cwd(),
      "tmp",
      `motion-raw-${stamp}.mp4`,
    );
    await mkdir(path.dirname(tempRawPath), { recursive: true });

    rawTempPath = await writeTempBuffer("hook-raw", ".mp4", videoBytes);

    // AI clips often include ambient audio — hooks should be silent.
    await stripAudioFromVideo({
      inputPath: rawTempPath,
      outputPath: tempRawPath,
    });

    const normalizedTemp = path.join(
      process.cwd(),
      "tmp",
      `motion-norm-${stamp}.mp4`,
    );
    await normalizeToReelFrame({
      inputPath: tempRawPath,
      outputPath: normalizedTemp,
    });
    await copyFile(normalizedTemp, tempRawPath);
    await safeUnlink(normalizedTemp);

    const rawBuffer = await readFile(tempRawPath);
    const motion = await saveMotionFromBuffer({
      buffer: rawBuffer,
      ext: ".mp4",
      name: actionPrompt || "Generated motion",
      durationSeconds: 4,
      actionPrompt,
    });
    await safeUnlink(tempRawPath);

    return NextResponse.json({
      url: motion.url,
      rawUrl: motion.url,
      model: usedModel,
      durationSeconds: 4,
      actionPrompt,
      referenceMotionId,
      motionId: motion.id,
      motion,
      usedReferenceImage,
      fallbackNote: fallbackNote ?? null,
    });
  } catch (err) {
    const { message, status } = usedKlingProvider
      ? formatKlingError(err)
      : formatGeminiError(err);
    console.error("[generate-hook]", err);
    return NextResponse.json({ error: message }, { status });
  } finally {
    if (rawTempPath) await safeUnlink(rawTempPath);
  }
}
