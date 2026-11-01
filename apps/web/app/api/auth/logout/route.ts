import { NextResponse } from "next/server";
import { assertRequestOrigin, authOrigin } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { assertRequestOrigin(request, authOrigin(request)); }
  catch { return NextResponse.json({ error: "Request origin mismatch" }, { status: 403 }); }
  const id = request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith("captab_session="))?.slice("captab_session=".length);
  if (id) getDatabase().prepare("UPDATE sessions SET session_expires_at = ? WHERE id = ?").run(new Date(0).toISOString(), id);
  const response = NextResponse.json({ accountId: null });
  response.cookies.set("captab_session", "", { httpOnly: true, secure: authOrigin(request).startsWith("https://"), sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
