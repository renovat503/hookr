import path from "path";
import { copyFile } from "fs/promises";
import { NextResponse } from "next/server";
import { readLibrary, updateHook } from "@/lib/library-store";
import { burnTextOverlay, safeUnlink } from "@/lib/ffmpeg";
import { mergeOverlayStyle } from "@/lib/overlay-style";
import { overwriteMediaAtUrl, resolveToLocalPath } from "@/lib/storage/media";
import type { OverlayStyle } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  hookId?: string;
  overlayStyle?: Partial<OverlayStyle>;
};

export async function POST(request: Request) {
  let tempIn: string | null = null;
  let tempOut: string | null = null;

  try {
    const body = (await request.json()) as Body;
    if (!body.hookId) {
      return NextResponse.json({ error: "hookId is required." }, { status: 400 });
    }

    const data = await readLibrary();
    const hook = data.hooks.find((h) => h.id === body.hookId);
    if (!hook) {
      return NextResponse.json({ error: "Hook not found." }, { status: 404 });
    }
    if (!hook.overlayText?.trim()) {
      return NextResponse.json(
        { error: "This hook has no overlay text to burn." },
        { status: 400 },
      );
    }
    if (hook.overlayBurned) {
      return NextResponse.json(hook);
    }

    const hookPath = await resolveToLocalPath(hook.url);
    tempIn = path.join(process.cwd(), "tmp", `${hook.id}-preburn.mp4`);
    tempOut = path.join(process.cwd(), "tmp", `${hook.id}-burned.mp4`);
    await copyFile(hookPath, tempIn);

    await burnTextOverlay({
      inputPath: tempIn,
      outputPath: tempOut,
      text: hook.overlayText,
      style: mergeOverlayStyle({
        ...hook.overlayStyle,
        ...body.overlayStyle,
      }),
    });

    const storedUrl = await overwriteMediaAtUrl({
      url: hook.url,
      localPath: tempOut,
      contentType: "video/mp4",
    });

    hook.url = storedUrl;
    hook.overlayBurned = true;
    await updateHook(hook);

    return NextResponse.json(hook);
  } catch (err) {
    console.error("[hooks/burn-overlay]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Burn failed." },
      { status: 500 },
    );
  } finally {
    if (tempIn) await safeUnlink(tempIn);
    if (tempOut) await safeUnlink(tempOut);
  }
}
