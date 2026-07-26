import { describeMotionFromReferenceVideo } from "@/lib/gemini";
import { addMotion } from "@/lib/library-store";
import {
  guessVideoContentType,
  saveMediaFromLocalPath,
} from "@/lib/storage/media";
import { prepareVideoForStorage } from "@/lib/storage/prepare-video-upload";
import { safeUnlink } from "@/lib/ffmpeg";
import type { LibraryMotion } from "@/lib/types";

async function analyzeMotionFromFile(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (!process.env.GEMINI_API_KEY?.trim()) return "";
  try {
    return await describeMotionFromReferenceVideo({
      videoBase64: buffer.toString("base64"),
      videoMimeType: mimeType || "video/mp4",
    });
  } catch (err) {
    console.warn("[save-motion] motion analysis failed", err);
    return "";
  }
}

export async function saveMotionFromBuffer(options: {
  buffer: Buffer;
  ext: string;
  name: string;
  durationSeconds: number;
  actionPrompt?: string;
  sourceHookId?: string | null;
}): Promise<LibraryMotion> {
  const id = `motion-${Date.now()}`;
  const filename = `${id}${options.ext}`;
  const storageKey = `uploads/motions/${filename}`;
  const contentType = guessVideoContentType(filename);

  const prepared = await prepareVideoForStorage({
    buffer: options.buffer,
    filename,
    contentType,
  });

  try {
    const url = await saveMediaFromLocalPath({
      storageKey,
      localPath: prepared.localPath,
      contentType: prepared.contentType || contentType,
    });

    let actionPrompt = options.actionPrompt?.trim() ?? "";
    if (!actionPrompt) {
      actionPrompt = await analyzeMotionFromFile(options.buffer, contentType);
    }

    const displayName = prepared.compressed
      ? `${options.name} (compressed)`
      : options.name;

    return addMotion({
      id,
      name: displayName,
      url,
      actionPrompt,
      durationSeconds: options.durationSeconds,
      sourceHookId: options.sourceHookId ?? null,
      uploadedAt: new Date().toISOString(),
    });
  } finally {
    for (const filePath of prepared.cleanup) {
      await safeUnlink(filePath);
    }
  }
}
