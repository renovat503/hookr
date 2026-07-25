import { NextResponse } from "next/server";
import {
  createSessionToken,
  isSecureRequest,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth-session";
import { getAppPassword, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    getAppPassword();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Authentication is not configured.",
      },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as { password?: string };
    const password = body.password ?? "";
    if (!verifyPassword(password)) {
      return NextResponse.json({ error: "Invalid password." }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(
      SESSION_COOKIE,
      await createSessionToken(),
      sessionCookieOptions(isSecureRequest(request)),
    );
    return res;
  } catch {
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
