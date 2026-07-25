import { NextResponse } from "next/server";
import { addDemo } from "@/lib/library-store";
import { appendAssetToActiveCampaign } from "@/lib/sync-campaign-assets";
import {
  getStorageBucket,
  getSupabaseAdmin,
  toPublicMediaUrl,
} from "@/lib/storage/supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      filename?: string;
      durationSeconds?: number;
      storageKey?: string;
    };

    const id = body.id?.trim();
    const storageKey = body.storageKey?.trim();
    const filename = body.filename?.trim() || "Demo";
    const durationSeconds = Math.max(
      1,
      Math.round(Number(body.durationSeconds ?? 0)) || 1,
    );

    if (!id || !storageKey) {
      return NextResponse.json(
        { error: "id and storageKey are required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(getStorageBucket())
      .createSignedUrl(storageKey, 60);

    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { error: "Uploaded file was not found in storage." },
        { status: 404 },
      );
    }

    const head = await fetch(data.signedUrl, { method: "HEAD" });
    if (!head.ok) {
      return NextResponse.json(
        { error: "Uploaded file was not found in storage." },
        { status: 404 },
      );
    }

    const url = toPublicMediaUrl(storageKey);
    const demo = await addDemo({
      id,
      name: filename.replace(/\.[^/.]+$/, "") || "Demo",
      url,
      durationSeconds,
      uploadedAt: new Date().toISOString(),
    });

    await appendAssetToActiveCampaign("demos", id);
    return NextResponse.json(demo);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save demo." },
      { status: 500 },
    );
  }
}
