import { NextResponse } from "next/server";
import { getActiveCampaignId } from "@/lib/active-campaign";
import { readInstagram, updateScheduledPost } from "@/lib/instagram-store";
import { postsInDateRange } from "@/lib/posting-slots";

export const runtime = "nodejs";

type BulkCancelBody = {
  accountId?: string;
  fromDateIso?: string;
  toDateIso?: string;
  timezoneOffsetMinutes?: number;
};

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BulkCancelBody;
    const accountId = body.accountId?.trim();
    const fromDateIso = body.fromDateIso?.trim() ?? "";
    const toDateIso = body.toDateIso?.trim() ?? "";
    const timezoneOffsetMinutes =
      typeof body.timezoneOffsetMinutes === "number"
        ? body.timezoneOffsetMinutes
        : 0;

    if (!accountId || !fromDateIso || !toDateIso) {
      return NextResponse.json(
        { error: "accountId, fromDateIso, and toDateIso are required." },
        { status: 400 },
      );
    }

    if (!DATE_ISO.test(fromDateIso) || !DATE_ISO.test(toDateIso)) {
      return NextResponse.json(
        { error: "Dates must be YYYY-MM-DD." },
        { status: 400 },
      );
    }

    if (fromDateIso > toDateIso) {
      return NextResponse.json(
        { error: "fromDateIso must be on or before toDateIso." },
        { status: 400 },
      );
    }

    const campaignId = await getActiveCampaignId();
    const instagram = await readInstagram(campaignId);
    const account = instagram.accounts.find((item) => item.id === accountId);
    if (!account) {
      return NextResponse.json(
        { error: "Instagram account not found." },
        { status: 404 },
      );
    }

    const targets = postsInDateRange(
      instagram.scheduledPosts,
      accountId,
      fromDateIso,
      toDateIso,
      timezoneOffsetMinutes,
    );

    const ids: string[] = [];
    for (const post of targets) {
      await updateScheduledPost(post.id, {
        status: "cancelled",
        error: null,
      });
      ids.push(post.id);
    }

    return NextResponse.json({ cancelled: ids.length, ids });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not bulk unschedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
