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

export async function POST(request: Request) {
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

    const ext = path.extname(file.name) || ".mp4";
    const id = `demo-${Date.now()}`;
    const filename = `${id}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await saveMediaBuffer({
      storageKey: `uploads/demos/${filename}`,
      buffer,
      contentType: file.type || guessVideoContentType(filename),
    });

    const durationRaw = form.get("durationSeconds");
    const durationSeconds =
      typeof durationRaw === "string" && durationRaw
        ? Math.max(1, Math.round(Number(durationRaw)))
        : 0;

    const demo = await addDemo({
      id,
      name: file.name.replace(/\.[^/.]+$/, ""),
      url,
      durationSeconds,
      uploadedAt: new Date().toISOString(),
    });

    await appendAssetToActiveCampaign("demos", id);

    return NextResponse.json(demo);
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
