import path from "path";
import { NextResponse } from "next/server";
import { addMusic, readLibrary, removeLibraryItem } from "@/lib/library-store";
import {
  deleteMedia,
  guessAudioContentType,
  saveMediaBuffer,
} from "@/lib/storage/media";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No audio file provided." }, { status: 400 });
    }

    if (!file.type.startsWith("audio/")) {
      return NextResponse.json(
        { error: "Please upload an audio file (MP3, M4A, WAV, etc.)." },
        { status: 400 },
      );
    }

    const ext = path.extname(file.name) || ".mp3";
    const id = `music-${Date.now()}`;
    const filename = `${id}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await saveMediaBuffer({
      storageKey: `uploads/music/${filename}`,
      buffer,
      contentType: file.type || guessAudioContentType(filename),
    });

    const durationRaw = form.get("durationSeconds");
    const durationSeconds =
      typeof durationRaw === "string" && durationRaw
        ? Math.max(1, Math.round(Number(durationRaw)))
        : 0;

    const track = await addMusic({
      id,
      name: file.name.replace(/\.[^/.]+$/, ""),
      url,
      durationSeconds,
      uploadedAt: new Date().toISOString(),
    });

    return NextResponse.json(track);
  } catch (err) {
    console.error("[library/music]", err);
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
    const track = library.music.find((item) => item.id === id);
    if (!track) {
      return NextResponse.json({ error: "Track not found." }, { status: 404 });
    }

    await deleteMedia(track.url);
    await removeLibraryItem("music", id);

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not delete track.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
