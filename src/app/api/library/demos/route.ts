import path from "path";
import { NextResponse } from "next/server";
import { addDemo, readLibrary, removeLibraryItem } from "@/lib/library-store";
import { appendAssetToActiveCampaign } from "@/lib/sync-campaign-assets";
import {
  deleteMedia,
  guessVideoContentType,
  saveMediaBuffer,
} from "@/lib/storage/media";

export const runtime = "nodejs";
export const maxDuration = 120;

function parseDuration(value: string | null): number {
  if (!value) return 0;
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 0;
}

async function saveDemoUpload(options: {
  buffer: Buffer;
  filename: string;
  contentType: string;
  durationSeconds: number;
}) {
  const ext = path.extname(options.filename) || ".mp4";
  const id = `demo-${Date.now()}`;
  const storageName = `${id}${ext}`;
  const url = await saveMediaBuffer({
    storageKey: `uploads/demos/${storageName}`,
    buffer: options.buffer,
    contentType: options.contentType || guessVideoContentType(storageName),
  });

  const demo = await addDemo({
    id,
    name: options.filename.replace(/\.[^/.]+$/, "") || "Demo",
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 500 },
    );
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
