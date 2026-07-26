import path from "path";
import { stat } from "fs/promises";
import {
  compressVideoForStorage,
  hookrTmpDir,
  safeUnlink,
  writeTempBuffer,
} from "@/lib/ffmpeg";
import {
  formatMegabytes,
  getMaxServerCompressBytes,
  getMaxUploadBytes,
} from "@/lib/storage/upload-limits";

export async function prepareVideoForStorage(options: {
  buffer?: Buffer;
  inputPath?: string;
  filename: string;
  contentType: string;
}): Promise<{
  localPath: string;
  contentType: string;
  compressed: boolean;
  cleanup: string[];
}> {
  const maxBytes = getMaxUploadBytes();
  const maxServerBytes = getMaxServerCompressBytes();
  const sourcePath =
    options.inputPath ??
    (options.buffer
      ? await writeTempBuffer(
          "video-in",
          path.extname(options.filename) || ".mp4",
          options.buffer,
        )
      : null);

  if (!sourcePath) {
    throw new Error("Upload payload is missing.");
  }

  const ownedTempInput = !options.inputPath;
  const { size } = await stat(sourcePath);

  if (size > maxServerBytes) {
    if (ownedTempInput) await safeUnlink(sourcePath);
    throw new Error(
      `This video is ${formatMegabytes(size)} — too large to compress on the server. Trim it to under ${formatMegabytes(maxServerBytes)} or export a smaller MP4 first.`,
    );
  }

  if (size <= maxBytes) {
    return {
      localPath: sourcePath,
      contentType: options.contentType,
      compressed: false,
      cleanup: ownedTempInput ? [sourcePath] : [],
    };
  }

  const outputPath = path.join(
    hookrTmpDir(),
    `video-compressed-${Date.now()}.mp4`,
  );

  try {
    await compressVideoForStorage({
      inputPath: sourcePath,
      outputPath,
      maxBytes,
    });
    return {
      localPath: outputPath,
      contentType: "video/mp4",
      compressed: true,
      cleanup: [outputPath, ...(ownedTempInput ? [sourcePath] : [])],
    };
  } catch (err) {
    if (ownedTempInput) await safeUnlink(sourcePath);
    await safeUnlink(outputPath);
    throw err;
  }
}
