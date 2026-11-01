import { NextResponse } from "next/server";
import { assertRequestOrigin, authOrigin, createChallenge } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const origin = authOrigin(request);
    assertRequestOrigin(request, origin);
    const raw = await request.text();
    if (raw.length > 256) return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const body = JSON.parse(raw) as { accountId?: unknown };
    if (typeof body.accountId !== "string") throw new Error("Missing account ID");
    const challenge = createChallenge(body.accountId, origin);
    const response = NextResponse.json({ nonce: challenge.nonce, message: challenge.message, recipient: challenge.recipient, expiresAt: challenge.expiresAt });
    response.cookies.set("captab_challenge", challenge.id, { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "strict", path: "/api/auth", maxAge: 300 });
    return response;
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Challenge failed" }, { status: 400 }); }
}
