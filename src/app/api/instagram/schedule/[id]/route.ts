import { NextResponse } from "next/server";
import {
  readInstagram,
  removeScheduledPost,
  updateScheduledPost,
} from "@/lib/instagram-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type PatchBody = {
  status?: string;
  scheduledAt?: string;
  caption?: string;
};

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  await removeScheduledPost(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json()) as PatchBody;
  const instagram = await readInstagram();
  const existing = instagram.scheduledPosts.find((post) => post.id === id);
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (body.status === "cancelled") {
    const updated = await updateScheduledPost(id, {
      status: "cancelled",
      error: null,
    });
    return NextResponse.json(updated);
  }

  const patch: Parameters<typeof updateScheduledPost>[1] = {};

  if (body.caption !== undefined) {
    patch.caption = body.caption.trim();
  }

  if (body.scheduledAt !== undefined) {
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json(
        { error: "Invalid scheduledAt datetime." },
        { status: 400 },
      );
    }
    if (
      existing.status !== "published" &&
      scheduledAt.getTime() < Date.now() - 60_000
    ) {
      return NextResponse.json(
        { error: "Schedule time must be in the future." },
        { status: 400 },
      );
    }
    patch.scheduledAt = scheduledAt.toISOString();
  }

  if (existing.status === "queued" && body.scheduledAt) {
    patch.status = "scheduled";
    patch.source = "manual";
    patch.queuePosition = null;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Unsupported patch." }, { status: 400 });
  }

  const updated = await updateScheduledPost(id, patch);
  if (!updated) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json(updated);
}
