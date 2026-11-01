import { NextResponse } from "next/server";
import { enqueueDistribution } from "../../../../../lib/payments";
import { validAccountId } from "../../../../../lib/near";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const secret = process.env.CAPTAB_WORKER_SECRET;
  if (!secret) return NextResponse.json({ error: "Worker secret is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^(0|[1-9][0-9]*)$/.test(id) || !Number.isSafeInteger(Number(id))) return NextResponse.json({ error: "Invalid distribution ID" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const companyId = body && typeof body === "object" && "companyId" in body ? (body as { companyId: unknown }).companyId : null;
  if (typeof companyId !== "string" || !validAccountId(companyId)) return NextResponse.json({ error: "Invalid company ID" }, { status: 400 });
  try { return NextResponse.json(await enqueueDistribution(companyId, Number(id)), { status: 202 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Queue failed" }, { status: 409 }); }
}
