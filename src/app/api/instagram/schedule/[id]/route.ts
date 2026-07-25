import { NextResponse } from "next/server";
import {
  removeScheduledPost,
  updateScheduledPost,
} from "@/lib/instagram-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  await removeScheduledPost(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json()) as { status?: string };
  if (body.status === "cancelled") {
    const updated = await updateScheduledPost(id, {
      status: "cancelled",
      error: null,
    });
    if (!updated) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json(updated);
  }
  return NextResponse.json({ error: "Unsupported patch." }, { status: 400 });
}
