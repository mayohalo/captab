import { NextResponse } from "next/server";
import { accountFromSession, assertRequestOrigin, authOrigin } from "../../../../../lib/auth";
import { ensureCompany, getDatabase } from "../../../../../lib/db";
import { type CompanyConfig, type DaoPolicy, type Grant, type Holding, validAccountId, view } from "../../../../../lib/near";

export const runtime = "nodejs";

async function context(contractId: string, accountId: string) {
  const config = await view<CompanyConfig>(contractId, "get_config");
  const policy = await view<DaoPolicy>(config.dao_id, "get_policy");
  const council = policy.roles.some(role => role.name === "council" && role.kind.Group?.includes(accountId));
  const companyId = ensureCompany(getDatabase(), contractId, config.dao_id);
  return { companyId, council };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = accountFromSession(request);
  if (!accountId) return NextResponse.json({ error: "Wallet verification required" }, { status: 401 });
  if (!validAccountId(id)) return NextResponse.json({ error: "Invalid company" }, { status: 400 });
  try {
    const { companyId, council } = await context(id, accountId);
    const db = getDatabase();
    const profiles = council
      ? db.prepare("SELECT account_id, display_name, email FROM stakeholders WHERE company_id = ? ORDER BY account_id").all(companyId)
      : db.prepare("SELECT account_id, display_name, email FROM stakeholders WHERE company_id = ? AND account_id = ?").all(companyId, accountId);
    return NextResponse.json({ council, profiles }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Company or DAO policy unavailable" }, { status: 502 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = accountFromSession(request);
  if (!actor) return NextResponse.json({ error: "Wallet verification required" }, { status: 401 });
  if (!validAccountId(id)) return NextResponse.json({ error: "Invalid company" }, { status: 400 });
  try { assertRequestOrigin(request, authOrigin(request)); }
  catch { return NextResponse.json({ error: "Request origin mismatch" }, { status: 403 }); }
  const raw = await request.text();
  if (raw.length > 1_024) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { accountId, displayName, email } = body;
  if (typeof accountId !== "string" || !validAccountId(accountId) ||
      !(displayName === null || typeof displayName === "string" && displayName.length <= 120) ||
      !(email === null || typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return NextResponse.json({ error: "Invalid profile" }, { status: 400 });
  }
  try {
    const { companyId, council } = await context(id, actor);
    if (!council) return NextResponse.json({ error: "Council access required" }, { status: 403 });
    const [holdings, grantPages] = await Promise.all([
      view<Holding[]>(id, "list_holdings", { from_index: 0, limit: 20 }),
      Promise.all([0, 20, 40, 60, 80].map(from_index => view<Grant[]>(id, "list_grants", { from_index, limit: 20 }))),
    ]);
    const grants = grantPages.flat();
    if (!holdings.some(row => row.account_id === accountId) && !grants.some(row => row.recipient === accountId)) {
      return NextResponse.json({ error: "Account is not an on-chain stakeholder" }, { status: 409 });
    }
    getDatabase().prepare(`INSERT INTO stakeholders (company_id, account_id, display_name, email) VALUES (?, ?, ?, ?)
      ON CONFLICT(company_id, account_id) DO UPDATE SET display_name = excluded.display_name, email = excluded.email`)
      .run(companyId, accountId, displayName, email);
    return NextResponse.json({ accountId, displayName, email });
  } catch { return NextResponse.json({ error: "Company or DAO policy unavailable" }, { status: 502 }); }
}
