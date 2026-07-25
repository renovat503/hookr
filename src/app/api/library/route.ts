import { NextResponse } from "next/server";
import { readLibrary, type LibraryScope } from "@/lib/library-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const scopeParam = new URL(request.url).searchParams.get("scope");
  const scope: LibraryScope = scopeParam === "pickers" ? "pickers" : "full";
  const library = await readLibrary(scope);
  return NextResponse.json(library);
}
