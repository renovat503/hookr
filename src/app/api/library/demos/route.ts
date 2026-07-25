import path from "path";
import { readFile, stat } from "fs/promises";
import { NextResponse } from "next/server";
import { addDemo, readLibrary, removeLibraryItem } from "@/lib/library-store";
import { appendAssetToActiveCampaign } from "@/lib/sync-campaign-assets";
import {
  deleteMedia,
  guessVideoContentType,
  saveMediaBuffer,
} from "@/lib/storage/media";
import {
  getMaxUploadBytes,
  isSupabaseSizeLimitError,
  supabaseSizeLimitMessage,
} from "@/lib/storage/upload-limits";
import {
  compressVideoForStorage,
  hookrTmpDir,
  safeUnlink,
  writeTempBuffer,
} from "@/lib/ffmpeg";
import { streamRequestBodyToFile } from "@/lib/stream-request-body";

export const runtime = "nodejs";
export const maxDuration = 600;

function parseDuration(value: string | null): number {
  if (!value) return 0;
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 0;
}

async function prepareDemoBuffer(options: {
  buffer?: Buffer;
  inputPath?: string;
  filename: string;
  contentType: string;
}): Promise<{ buffer: Buffer; contentType: string; compressed: boolean }> {
  const maxBytes = getMaxUploadBytes();
  const sourcePath =
    options.inputPath ??
    (options.buffer
      ? await writeTempBuffer(
          "demo-in",
          path.extname(options.filename) || ".mp4",
          options.buffer,
        )
      : null);

  if (!sourcePath) {
    throw new Error("Upload payload is missing.");
  }

  const ownedTempInput = !options.inputPath;
  const { size } = await stat(sourcePath);

  if (size <= maxBytes) {
    const buffer = options.buffer ?? (await readFile(sourcePath));
    if (ownedTempInput) await safeUnlink(sourcePath);
    return {
      buffer,
      contentType: options.contentType,
      compressed: false,
    };
  }

  const outputPath = path.join(
    hookrTmpDir(),
    `demo-compressed-${Date.now()}.mp4`,
  );

  try {
    await compressVideoForStorage({
      inputPath: sourcePath,
      outputPath,
      maxBytes,
    });
    const buffer = await readFile(outputPath);
    return {
      buffer,
      contentType: "video/mp4",
      compressed: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not compress video.";
    throw new Error(
      `${message} Try a shorter clip, or raise the global upload limit in Supabase → Storage → Settings.`,
    );
  } finally {
    if (ownedTempInput) await safeUnlink(sourcePath);
    await safeUnlink(outputPath);
  }
}

async function saveDemoUpload(options: {
  buffer?: Buffer;
  inputPath?: string;
  filename: string;
  contentType: string;
  durationSeconds: number;
}) {
  const prepared = await prepareDemoBuffer(options);
  const id = `demo-${Date.now()}`;
  const storageName = `${id}.mp4`;
  const url = await saveMediaBuffer({
    storageKey: `uploads/demos/${storageName}`,
    buffer: prepared.buffer,
    contentType: prepared.contentType || guessVideoContentType(storageName),
  });

  const baseName = options.filename.replace(/\.[^/.]+$/, "") || "Demo";
  const demo = await addDemo({
    id,
    name: prepared.compressed ? `${baseName} (compressed)` : baseName,
    url,
    durationSeconds: options.durationSeconds,
    uploadedAt: new Date().toISOString(),
  });

  await appendAssetToActiveCampaign("demos", id);
  return demo;
}

async function handleRawUpload(request: Request) {
  const params = new URL(request.url).searchParams;
  const filename = params.get("filename")?.trim() || "upload.mp4";
  const durationSeconds = parseDuration(params.get("durationSeconds"));
  const contentType = request.headers.get("content-type") ?? "video/mp4";

  if (
    contentType &&
    !contentType.startsWith("video/") &&
    contentType !== "application/octet-stream"
  ) {
    return NextResponse.json(
      { error: "Please upload a video file (MP4, MOV, etc.)." },
      { status: 400 },
    );
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  const streamToDisk =
    Number.isFinite(contentLength) && contentLength > 8 * 1024 * 1024;
  let inputPath: string | null = null;

  try {
    if (streamToDisk) {
      inputPath = path.join(hookrTmpDir(), `demo-upload-${Date.now()}.mp4`);
      await streamRequestBodyToFile(request, inputPath);
      const demo = await saveDemoUpload({
        inputPath,
        filename,
        contentType,
        durationSeconds,
      });
      return NextResponse.json(demo);
    }

    const buffer = Buffer.from(await request.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty upload." }, { status: 400 });
    }

    const demo = await saveDemoUpload({
      buffer,
      filename,
      contentType,
      durationSeconds,
    });

    return NextResponse.json(demo);
  } finally {
    if (inputPath) await safeUnlink(inputPath);
  }
}

async function handleMultipartUpload(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    const contentType = request.headers.get("content-type") ?? "";
    const contentLength = request.headers.get("content-length") ?? "";
    console.error("[library/demos] formData parse failed", {
      contentType,
      contentLength,
      err,
    });
    return NextResponse.json(
      {
        error:
          "Upload could not be read. Retry the upload — the app now supports direct video uploads.",
      },
      { status: 413 },
    );
  }

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

  const durationRaw = form.get("durationSeconds");
  const durationSeconds =
    typeof durationRaw === "string" && durationRaw
      ? Math.max(1, Math.round(Number(durationRaw)))
      : 0;

  const demo = await saveDemoUpload({
    buffer: Buffer.from(await file.arrayBuffer()),
    filename: file.name,
    contentType: file.type || guessVideoContentType(file.name),
    durationSeconds,
  });

  return NextResponse.json(demo);
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      return await handleMultipartUpload(request);
    }
    return await handleRawUpload(request);
  } catch (err) {
    console.error("[library/demos]", err);
    const message = err instanceof Error ? err.message : "Upload failed.";
    if (isSupabaseSizeLimitError(message)) {
      return NextResponse.json(
        { error: supabaseSizeLimitMessage(0) },
        { status: 413 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }

    const library = await readLibrary();
    const demo = library.demos.find((item) => item.id === id);
    if (!demo) {
      return NextResponse.json({ error: "Demo not found." }, { status: 404 });
    }

    await deleteMedia(demo.url);
    await removeLibraryItem("demos", id);

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not delete demo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
