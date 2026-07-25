import { mkdir, readFile, unlink } from "fs/promises";
import { GoogleGenAI } from "@google/genai";
import { CHARACTER_PRESETS } from "@/lib/constants";
import {
  OMNI_FLASH_MODEL,
  VEO_FAST_MODEL,
  VEO_QUALITY_MODEL,
} from "@/lib/video-models";

export { OMNI_FLASH_MODEL, VEO_FAST_MODEL, VEO_QUALITY_MODEL };
export const DEFAULT_VEO_MODEL = VEO_FAST_MODEL;
export const DEFAULT_HOOK_MODEL = OMNI_FLASH_MODEL;

/** @deprecated Use resolveHookModel() or GEMINI_HOOK_MODEL */
export const VEO_MODEL = DEFAULT_VEO_MODEL;

export function resolveHookModel(): string {
  const hookModel = process.env.GEMINI_HOOK_MODEL?.trim();
  if (hookModel) return hookModel;
  const legacyVeo = process.env.GEMINI_VEO_MODEL?.trim();
  if (legacyVeo) return legacyVeo;
  return DEFAULT_HOOK_MODEL;
}

export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.5-flash";

export function resolveTextModel(): string {
  return (
    process.env.GEMINI_TEXT_MODEL?.trim() ||
    process.env.GEMINI_VISION_MODEL?.trim() ||
    DEFAULT_GEMINI_TEXT_MODEL
  );
}

export function resolveVisionModel(): string {
  return process.env.GEMINI_VISION_MODEL?.trim() || DEFAULT_GEMINI_TEXT_MODEL;
}

export function isVeoModel(model: string): boolean {
  return /^veo-/i.test(model.trim());
}

export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing GEMINI_API_KEY. Add it to .env.local (see .env.local.example).",
    );
  }
  return new GoogleGenAI({ apiKey });
}

export async function describeMotionFromReferenceVideo(options: {
  videoBase64: string;
  videoMimeType: string;
}): Promise<string> {
  const ai = getGeminiClient();
  const model = resolveVisionModel();

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: options.videoMimeType,
              data: options.videoBase64,
            },
          },
          {
            text: [
              "Watch this short vertical hook video.",
              "Describe ONLY the person's body motion, gestures, facial expressions, head movement, and energy in one concise English sentence (max 30 words).",
              'Write it as a direct action description suitable for AI video generation, e.g. "Laughing happily with hand over the mouth continuously".',
              "Do not describe clothing, background, or identity. No quotes.",
            ].join(" "),
          },
        ],
      },
    ],
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Could not analyze the reference hook motion.");
  }
  return text.replace(/^["']|["']$/g, "");
}

export function geminiErrorText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const parts = [err.message];
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause) parts.push(geminiErrorText(cause));
    return parts.filter(Boolean).join(" ");
  }
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ["message", "statusText", "status", "code"]) {
      const v = o[key];
      if (typeof v === "string" || typeof v === "number") parts.push(String(v));
    }
    if (o.error) parts.push(geminiErrorText(o.error));
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return "";
    }
  }
  return String(err);
}

export function isLikenessBlockedError(err: unknown): boolean {
  const raw = geminiErrorText(err);
  return /real people|likeness|can't create videos|Input blocked|names or likenesses|celebrity|public figure/i.test(
    raw,
  );
}

export function isGenerationBlockedError(err: unknown): boolean {
  const raw = geminiErrorText(err);
  return (
    isLikenessBlockedError(err) ||
    /\bblocked\b|SAFETY|content.?policy|prompt.?blocked|may have been blocked/i.test(
      raw,
    )
  );
}

export function buildHookPrompt(input: {
  actionPrompt: string;
  characterSource: "upload" | "preset";
  characterPresetId?: string | null;
  /** When true, emphasize matching a past hook's motion on a new character */
  matchReferenceMotion?: boolean;
  /** Reference image will be sent — keep prompt fictional, no personal names */
  hasReferenceImage?: boolean;
  /** e.g. "Bold storyteller" for text-only generation */
  taglineHint?: string | null;
}) {
  const preset = CHARACTER_PRESETS.find((p) => p.id === input.characterPresetId);
  const tagline =
    input.taglineHint?.trim() ||
    preset?.tagline ||
    "social media presenter";

  const subject = input.hasReferenceImage
    ? "A vertical 9:16 social media hook clip. Use the reference image as the opening frame — original fictional presenter, not a celebrity."
    : `A vertical 9:16 social media hook clip featuring an original fictional ${tagline.toLowerCase()}, looking at camera. Natural lighting, young adult presenter.`;

  const action = input.actionPrompt.trim();
  const motionLine = input.matchReferenceMotion
    ? input.hasReferenceImage
      ? `Perform this exact viral-hook motion with matching energy, timing, gesture, and expression: ${action}.`
      : `The character performs this exact viral-hook motion with matching energy, timing, gesture, and expression: ${action}.`
    : `The character is ${action}.`;

  return [
    subject,
    motionLine,
    "Shot on phone camera, natural lighting, high energy social media hook, no text on screen, no watermarks, 9:16 portrait framing.",
    "Single continuous unbroken shot, no scene cuts.",
    "No dialogue, no audio, silent video.",
  ].join(" ");
}

type InteractionLike = {
  id: string;
  status: string;
  output_video?: {
    data?: string;
    uri?: string;
  };
};

export async function pollUntilInteractionReady(
  ai: GoogleGenAI,
  interaction: InteractionLike,
  {
    intervalMs = 8000,
    timeoutMs = 6 * 60 * 1000,
  }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<InteractionLike> {
  const started = Date.now();
  let current = interaction;

  while (
    current.status === "in_progress" ||
    current.status === "requires_action"
  ) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Video generation timed out. Try again in a moment.");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    current = (await ai.interactions.get(current.id)) as InteractionLike;
  }

  if (
    current.status === "failed" ||
    current.status === "cancelled" ||
    current.status === "incomplete" ||
    current.status === "budget_exceeded"
  ) {
    throw new Error(
      "Video generation failed. The prompt may have been blocked or your API key may lack Omni Flash preview access.",
    );
  }

  if (current.status !== "completed") {
    throw new Error(`Video generation ended with status: ${current.status}`);
  }

  return current;
}

async function pollFileActive(ai: GoogleGenAI, fileRef: string) {
  const nameMatch = fileRef.match(/files\/[^/?]+/);
  const name = nameMatch?.[0] ?? fileRef;
  const started = Date.now();
  const timeoutMs = 6 * 60 * 1000;

  while (Date.now() - started < timeoutMs) {
    const info = await ai.files.get({ name });
    if (info.state === "ACTIVE") return;
    if (info.state === "FAILED") {
      throw new Error("Video file processing failed.");
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  throw new Error("Video file processing timed out.");
}

async function readInteractionVideoBytes(
  ai: GoogleGenAI,
  interaction: InteractionLike,
  tempDownloadPath?: string,
): Promise<Buffer> {
  const video = interaction.output_video;
  if (!video) {
    throw new Error("Model returned no video. The prompt may have been blocked.");
  }

  if (video.data) {
    return Buffer.from(video.data, "base64");
  }

  if (video.uri) {
    await pollFileActive(ai, video.uri);
    if (!tempDownloadPath) {
      throw new Error("Internal error: missing temp path for video download.");
    }
    await ai.files.download({
      file: video.uri,
      downloadPath: tempDownloadPath,
    });
    try {
      return await readFile(tempDownloadPath);
    } finally {
      await unlink(tempDownloadPath).catch(() => undefined);
    }
  }

  throw new Error("Model returned no video data.");
}

async function generateHookVideoOmni(
  ai: GoogleGenAI,
  options: {
    model: string;
    prompt: string;
    imageBase64?: string | null;
    imageMimeType?: string | null;
    tempDownloadPath?: string;
  },
): Promise<Buffer> {
  const hasImage = Boolean(options.imageBase64?.trim());
  const input = hasImage
    ? [
        {
          type: "image" as const,
          data: options.imageBase64!.trim(),
          mime_type: options.imageMimeType || "image/jpeg",
        },
        {
          type: "text" as const,
          text: options.prompt,
        },
      ]
    : options.prompt;

  let interaction = (await ai.interactions.create({
    model: options.model,
    input,
    generation_config: {
      video_config: {
        task: hasImage ? "image_to_video" : "text_to_video",
      },
    },
    response_format: {
      type: "video",
      aspect_ratio: "9:16",
      duration: "4s",
    },
    background: false,
    store: false,
    stream: false,
  })) as InteractionLike;

  if (interaction.status !== "completed") {
    interaction = await pollUntilInteractionReady(ai, interaction);
  }

  return readInteractionVideoBytes(ai, interaction, options.tempDownloadPath);
}

async function generateHookVideoVeo(
  ai: GoogleGenAI,
  options: {
    model: string;
    prompt: string;
    imageBase64?: string | null;
    imageMimeType?: string | null;
    tempDownloadPath?: string;
  },
): Promise<Buffer> {
  const hasImage = Boolean(options.imageBase64?.trim());
  const operation = await ai.models.generateVideos({
    model: options.model,
    prompt: options.prompt,
    ...(hasImage
      ? {
          image: {
            imageBytes: options.imageBase64!.trim(),
            mimeType: options.imageMimeType || "image/jpeg",
          },
        }
      : {}),
    config: {
      aspectRatio: "9:16",
      durationSeconds: 4,
      numberOfVideos: 1,
      personGeneration: hasImage ? "allow_adult" : "allow_all",
      resolution: "720p",
    },
  });

  const finished = await pollUntilVideoReady(ai, operation);
  const remoteVideo = finished.response?.generatedVideos?.[0]?.video;

  if (!remoteVideo) {
    throw new Error("Veo returned no video. The prompt may have been blocked.");
  }

  if (remoteVideo.videoBytes) {
    return Buffer.from(remoteVideo.videoBytes, "base64");
  }

  if (!options.tempDownloadPath) {
    throw new Error("Internal error: missing temp path for Veo download.");
  }

  await ai.files.download({
    file: remoteVideo,
    downloadPath: options.tempDownloadPath,
  });
  try {
    return await readFile(options.tempDownloadPath);
  } finally {
    await unlink(options.tempDownloadPath).catch(() => undefined);
  }
}

export async function generateHookVideo(
  ai: GoogleGenAI,
  options: {
    prompt: string;
    /** Used when the reference image is blocked (Omni likeness policy, etc.) */
    textOnlyPrompt?: string;
    imageBase64?: string | null;
    imageMimeType?: string | null;
    tempDownloadPath?: string;
    model?: string;
  },
): Promise<{
  videoBytes: Buffer;
  model: string;
  usedReferenceImage: boolean;
  fallbackNote?: string;
}> {
  const configured = options.model ?? resolveHookModel();
  const hasImage = Boolean(options.imageBase64?.trim());
  // Omni Flash blocks most photorealistic image-to-video — route portraits to Veo.
  const primaryModel =
    hasImage && !isVeoModel(configured) ? DEFAULT_VEO_MODEL : configured;

  const run = (model: string, withImage: boolean, promptOverride?: string) =>
    isVeoModel(model)
      ? generateHookVideoVeo(ai, {
          ...options,
          prompt: promptOverride ?? options.prompt,
          model,
          imageBase64: withImage ? options.imageBase64 : null,
          imageMimeType: withImage ? options.imageMimeType : null,
        })
      : generateHookVideoOmni(ai, {
          ...options,
          prompt: promptOverride ?? options.prompt,
          model,
          imageBase64: withImage ? options.imageBase64 : null,
          imageMimeType: withImage ? options.imageMimeType : null,
        });

  const textOnlyFallback = async (reason: string) => {
    const textPrompt = options.textOnlyPrompt ?? options.prompt;
    const models = [DEFAULT_VEO_MODEL, OMNI_FLASH_MODEL].filter(
      (m, i, arr) => arr.indexOf(m) === i,
    );
    let lastErr: unknown;
    for (const model of models) {
      try {
        const videoBytes = await run(model, false, textPrompt);
        return {
          videoBytes,
          model,
          usedReferenceImage: false as const,
          fallbackNote: `${reason} Generated from your action prompt instead (face may differ).`,
        };
      } catch (err) {
        lastErr = err;
        if (!isGenerationBlockedError(err)) throw err;
      }
    }
    throw lastErr;
  };

  if (!hasImage) {
    const videoBytes = await run(primaryModel, false);
    return { videoBytes, model: primaryModel, usedReferenceImage: false };
  }

  try {
    const videoBytes = await run(primaryModel, true);
    return {
      videoBytes,
      model: primaryModel,
      usedReferenceImage: true,
      ...(primaryModel !== configured
        ? {
            fallbackNote:
              "Used Veo for your character photo (Omni Flash blocks most portrait references).",
          }
        : {}),
    };
  } catch (err) {
    if (!isGenerationBlockedError(err)) throw err;

    if (primaryModel !== DEFAULT_VEO_MODEL) {
      try {
        const videoBytes = await run(DEFAULT_VEO_MODEL, true);
        return {
          videoBytes,
          model: DEFAULT_VEO_MODEL,
          usedReferenceImage: true,
          fallbackNote:
            "Used Veo for your character photo (reference image was blocked).",
        };
      } catch (veoErr) {
        if (!isGenerationBlockedError(veoErr)) throw veoErr;
      }
    }

    return textOnlyFallback(
      "Your photo was blocked by Gemini's likeness policy —",
    );
  }
}

export async function pollUntilVideoReady(
  ai: GoogleGenAI,
  operation: Awaited<ReturnType<GoogleGenAI["models"]["generateVideos"]>>,
  {
    intervalMs = 8000,
    timeoutMs = 6 * 60 * 1000,
  }: { intervalMs?: number; timeoutMs?: number } = {},
) {
  const started = Date.now();
  let current = operation;

  while (!current.done) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Veo generation timed out. Try again in a moment.");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    current = await ai.operations.getVideosOperation({ operation: current });
  }

  if (current.error) {
    throw new Error(
      typeof current.error === "object" &&
        current.error !== null &&
        "message" in current.error
        ? String((current.error as { message: unknown }).message)
        : "Veo generation failed.",
    );
  }

  return current;
}

/** Turn raw Gemini / Veo / Omni SDK errors into short UI-friendly messages. */
export function formatGeminiError(err: unknown): { message: string; status: number } {
  const raw = geminiErrorText(err) || "Unexpected generation error.";

  if (/Omni Flash preview access|Video generation failed/i.test(raw)) {
    return { message: raw, status: 502 };
  }

  // SDK sometimes embeds JSON in the message
  const jsonMatch = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        error?: { code?: number; message?: string; status?: string };
      };
      const api = parsed.error;
      if (api?.code === 429 || api?.status === "RESOURCE_EXHAUSTED") {
        return {
          message:
            "Gemini API quota exceeded. Video generation needs billing enabled and available quota. Check usage at ai.dev/rate-limit, then retry.",
          status: 429,
        };
      }
      if (api?.message) {
        const blocked = isGenerationBlockedError({ message: api.message });
        return {
          message: blocked
            ? "Gemini blocked all generation attempts for this character photo. Try a stylized or illustrated portrait, or generate without a reference image."
            : api.message,
          status: api.code ?? 500,
        };
      }
    } catch {
      // fall through
    }
  }

  if (/429|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(raw)) {
    return {
      message:
        "Gemini API quota exceeded. Enable billing and check limits at ai.dev/rate-limit.",
      status: 429,
    };
  }

  return { message: raw, status: 500 };
}
