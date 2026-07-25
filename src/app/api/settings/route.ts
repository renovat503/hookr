import { NextResponse } from "next/server";
import { readAppSettings, updateAppSettings } from "@/lib/app-settings-store";
import { readLibrary } from "@/lib/library-store";
import { formatPgError } from "@/lib/db/connection-url";

export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await readAppSettings();
    return NextResponse.json(settings);
  } catch (err) {
    console.error("[settings] GET failed", err);
    return NextResponse.json({ error: formatPgError(err) }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      referenceMotionId?: string | null;
    };

    if (body.referenceMotionId !== undefined && body.referenceMotionId !== null) {
      const library = await readLibrary("create");
      const motion = library.motions.find((m) => m.id === body.referenceMotionId);
      if (!motion) {
        return NextResponse.json(
          { error: "Reference motion not found in your library." },
          { status: 404 },
        );
      }
    }

    const settings = await updateAppSettings({
      referenceMotionId:
        body.referenceMotionId === undefined
          ? undefined
          : body.referenceMotionId,
    });
    return NextResponse.json(settings);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not save app settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
