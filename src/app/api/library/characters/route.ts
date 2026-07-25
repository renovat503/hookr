import path from "path";
import { NextResponse } from "next/server";
import { addCharacter, readLibrary, removeLibraryItem } from "@/lib/library-store";
import {
  deleteMedia,
  guessImageContentType,
  saveMediaBuffer,
} from "@/lib/storage/media";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No image file provided." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Please upload an image file (PNG, JPG, etc.)." },
        { status: 400 },
      );
    }

    const ext = path.extname(file.name) || ".jpg";
    const id = `character-${Date.now()}`;
    const filename = `${id}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await saveMediaBuffer({
      storageKey: `uploads/characters/${filename}`,
      buffer,
      contentType: file.type || guessImageContentType(filename),
    });

    const nameRaw = form.get("name");
    const name =
      typeof nameRaw === "string" && nameRaw.trim()
        ? nameRaw.trim()
        : file.name.replace(/\.[^/.]+$/, "");

    const character = await addCharacter({
      id,
      name,
      url,
      uploadedAt: new Date().toISOString(),
    });

    return NextResponse.json(character);
  } catch (err) {
    console.error("[library/characters]", err);
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
      return NextResponse.json({ error: "Character id is required." }, { status: 400 });
    }

    const library = await readLibrary();
    const character = library.characters.find((item) => item.id === id);
    if (!character) {
      return NextResponse.json({ error: "Character not found." }, { status: 404 });
    }

    await removeLibraryItem("characters", id);
    await deleteMedia(character.url);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[library/characters]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed." },
      { status: 500 },
    );
  }
}
