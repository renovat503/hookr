import path from "path";
import { NextResponse } from "next/server";
import { readLibrary, removeLibraryItem } from "@/lib/library-store";
import { readAppSettings, updateAppSettings } from "@/lib/app-settings-store";
import { resolveToLocalPath, deleteMedia, saveMediaFromLocalPath } from "@/lib/storage/media";
import { saveMotionFromBuffer } from "@/lib/save-motion";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { hookId?: string };
      const hookId = body.hookId?.trim();
      if (!hookId) {
        return NextResponse.json(
          { error: "hookId is required." },
          { status: 400 },
        );
      }

      const library = await readLibrary();
      const existing = library.motions.find((m) => m.sourceHookId === hookId);
      if (existing) {
        return NextResponse.json(existing);
      }

      const hook = library.hooks.find((item) => item.id === hookId);
      if (!hook) {
        return NextResponse.json({ error: "Hook not found." }, { status: 404 });
      }

      const sourceUrl = hook.rawUrl || hook.url;
      const sourcePath = await resolveToLocalPath(sourceUrl);
      const ext = path.extname(sourcePath) || ".mp4";
      const { readFile } = await import("fs/promises");
      const buffer = await readFile(sourcePath);

      const motion = await saveMotionFromBuffer({
        buffer,
        ext,
        name: hook.actionPrompt || hook.overlayText || "Hook motion",
        durationSeconds: hook.durationSeconds || 4,
        actionPrompt: hook.actionPrompt,
        sourceHookId: hook.id,
      });

      return NextResponse.json(motion);
    }

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
    const buffer = Buffer.from(await file.arrayBuffer());
    const durationRaw = form.get("durationSeconds");
    const durationSeconds =
      typeof durationRaw === "string" && durationRaw
        ? Math.max(1, Math.round(Number(durationRaw)))
        : 4;

    const nameRaw = form.get("name");
    const name =
      typeof nameRaw === "string" && nameRaw.trim()
        ? nameRaw.trim()
        : file.name.replace(/\.[^/.]+$/, "");

    const motion = await saveMotionFromBuffer({
      buffer,
      ext,
      name,
      durationSeconds,
    });

    return NextResponse.json(motion);
  } catch (err) {
    console.error("[library/motions]", err);
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
      return NextResponse.json({ error: "Motion id is required." }, { status: 400 });
    }

    const library = await readLibrary();
    const motion = library.motions.find((item) => item.id === id);
    if (!motion) {
      return NextResponse.json({ error: "Motion not found." }, { status: 404 });
    }

    await removeLibraryItem("motions", id);
    await deleteMedia(motion.url);

    const settings = await readAppSettings();
    if (settings.referenceMotionId === id) {
      await updateAppSettings({ referenceMotionId: null });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[library/motions]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed." },
      { status: 500 },
    );
  }
}
