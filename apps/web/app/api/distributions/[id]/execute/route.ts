import { NextResponse } from "next/server";
import { enqueueDistribution } from "../../../../../lib/payments";
import { validAccountId } from "../../../../../lib/near";
import { accountFromSession, assertRequestOrigin, authOrigin } from "../../../../../lib/auth";
import { type CompanyConfig, type DaoPolicy, view } from "../../../../../lib/near";
import { getDatabase } from "../../../../../lib/db";

export const runtime = "nodejs";

async function authorized(request: Request, companyId: string): Promise<boolean> {
  const secret = process.env.CAPTAB_WORKER_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) return true;
  const actor = accountFromSession(request);
  if (!actor) return false;
  if (request.method !== "GET") assertRequestOrigin(request, authOrigin(request));
  const config = await view<CompanyConfig>(companyId, "get_config");
  const policy = await view<DaoPolicy>(config.dao_id, "get_policy");
  return policy.roles.some(role => role.name === "council" && role.kind.Group?.includes(actor));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^(0|[1-9][0-9]*)$/.test(id) || !Number.isSafeInteger(Number(id))) return NextResponse.json({ error: "Invalid distribution ID" }, { status: 400 });
  const raw = await request.text();
  if (raw.length > 256) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const companyId = body && typeof body === "object" && "companyId" in body ? (body as { companyId: unknown }).companyId : null;
  if (typeof companyId !== "string" || !validAccountId(companyId)) return NextResponse.json({ error: "Invalid company ID" }, { status: 400 });
  try {
    if (!await authorized(request, companyId)) return NextResponse.json({ error: "Verified council session required" }, { status: 403 });
    return NextResponse.json(await enqueueDistribution(companyId, Number(id)), { status: 202 });
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Queue failed" }, { status: 409 }); }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = new URL(request.url).searchParams.get("companyId");
  if (!/^(0|[1-9][0-9]*)$/.test(id) || !Number.isSafeInteger(Number(id)) || !companyId || !validAccountId(companyId)) {
    return NextResponse.json({ error: "Invalid distribution request" }, { status: 400 });
  }
  try {
    if (!await authorized(request, companyId)) return NextResponse.json({ error: "Verified council session required" }, { status: 403 });
    const rows = getDatabase().prepare(`SELECT j.recipient_id, j.attempt_id, j.submission_state, j.tx_hash, j.last_error, j.updated_at
      FROM payment_jobs j JOIN companies c ON c.id = j.company_id
      WHERE c.network = 'testnet' AND c.contract_id = ? AND j.distribution_id = ?
      ORDER BY j.recipient_id, j.attempt_id`).all(companyId, Number(id));
    return NextResponse.json({ jobs: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Queue unavailable" }, { status: 502 }); }
}
