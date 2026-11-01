import { NextResponse } from "next/server";
import { assertRequestOrigin, authOrigin } from "../../../lib/auth";
import { relaySponsoredClaim } from "../../../lib/sponsor";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { assertRequestOrigin(request, authOrigin(request)); }
  catch { return NextResponse.json({ error: "Request origin mismatch" }, { status: 403 }); }
  const raw = await request.text();
  if (raw.length > 8_192) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.companyId !== "string" || typeof body.signedDelegate !== "string") return NextResponse.json({ error: "Invalid sponsor request" }, { status: 400 });
  try { return NextResponse.json(await relaySponsoredClaim(body.companyId, body.signedDelegate), { status: 202 }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Sponsorship failed";
    return NextResponse.json({ error: message }, { status: message.includes("rate limit") ? 429 : message.includes("uncertain") ? 503 : 409 });
  }
}
