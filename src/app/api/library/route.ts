import { NextResponse } from "next/server";
import {
  parseLibraryScope,
  readLibrary,
} from "@/lib/library-store";
import { formatPgError } from "@/lib/db/connection-url";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = parseLibraryScope(
      new URL(request.url).searchParams.get("scope"),
    );
    const library = await readLibrary(scope);
    return NextResponse.json(library);
  } catch (err) {
    console.error("[library] GET failed", err);
    return NextResponse.json(
      { error: formatPgError(err) },
      { status: 503 },
    );
  }
}
