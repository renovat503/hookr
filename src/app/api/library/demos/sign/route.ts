import { NextResponse } from "next/server";
import { getMaxUploadBytes } from "@/lib/storage/upload-limits";
import {
  getStorageBucket,
  getSupabaseAdmin,
  toPublicMediaUrl,
} from "@/lib/storage/supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      filename?: string;
      durationSeconds?: number;
      fileSize?: number;
      contentType?: string;
    };

    const fileSize = Number(body.fileSize ?? 0);
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return NextResponse.json({ error: "fileSize is required." }, { status: 400 });
    }

    if (fileSize > getMaxUploadBytes()) {
      return NextResponse.json({ mode: "server" as const });
    }

    const id = `demo-${Date.now()}`;
    const storageKey = `uploads/demos/${id}.mp4`;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(getStorageBucket())
      .createSignedUploadUrl(storageKey);

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not create upload URL." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      mode: "direct" as const,
      id,
      signedUrl: data.signedUrl,
      storageKey: data.path,
      publicUrl: toPublicMediaUrl(data.path),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start upload." },
      { status: 500 },
    );
  }
}
