import { NextResponse } from "next/server";
import { accountFromSession } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const accountId = accountFromSession(request);
  return NextResponse.json({ accountId }, { headers: { "Cache-Control": "no-store" } });
}
