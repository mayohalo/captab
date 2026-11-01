import { NextResponse } from "next/server";
import { assertRequestOrigin, authOrigin, verifyChallenge } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const origin = authOrigin(request);
    assertRequestOrigin(request, origin);
    const challengeId = request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith("captab_challenge="))?.slice("captab_challenge=".length);
    if (!challengeId) throw new Error("Missing challenge cookie");
    const raw = await request.text();
    if (raw.length > 2_048) return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (typeof body.nonce !== "string" || typeof body.accountId !== "string" || typeof body.publicKey !== "string" || typeof body.signature !== "string") throw new Error("Invalid signed message");
    const session = await verifyChallenge({ challengeId, nonce: body.nonce, accountId: body.accountId, publicKey: body.publicKey, signature: body.signature }, origin);
    const response = NextResponse.json({ accountId: session.accountId, expiresAt: session.sessionExpiresAt });
    response.cookies.set("captab_challenge", "", { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "strict", path: "/api/auth", maxAge: 0 });
    response.cookies.set("captab_session", session.sessionId, { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "strict", path: "/", maxAge: 43_200 });
    return response;
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Verification failed" }, { status: 401 }); }
}
