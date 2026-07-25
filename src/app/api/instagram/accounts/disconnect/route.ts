import { NextResponse } from "next/server";
import { removeInstagramAccount } from "@/lib/instagram-store";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  await removeInstagramAccount(id);
  return NextResponse.json({ ok: true });
}
