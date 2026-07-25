import { NextResponse } from "next/server";
import { readLibrary } from "@/lib/library-store";

export async function GET() {
  const library = await readLibrary();
  return NextResponse.json(library);
}
