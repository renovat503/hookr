import { NextResponse } from "next/server";
import { removeYouTubeAccount } from "@/lib/youtube-store";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  await removeYouTubeAccount(id);
  return NextResponse.json({ ok: true });
}
