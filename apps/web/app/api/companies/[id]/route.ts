import { NextResponse } from "next/server";
import { ensureCompany, getDatabase } from "../../../../lib/db";
import { assessCompanyLedger } from "../../../../lib/company-health";
import { readCompany, type Totals, validAccountId, view } from "../../../../lib/near";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validAccountId(id)) return NextResponse.json({ error: "Invalid company account" }, { status: 400 });
  try {
    const chain = await readCompany(id);
    const revisionAfter = (await view<Totals>(id, "get_totals")).ledger_revision;
    const audit = assessCompanyLedger({ ...chain, revisionAfter });
    let history: Record<string, unknown>;
    try {
      const db = getDatabase();
      const companyRowId = ensureCompany(db, id, chain.config.dao_id);
      const row = db.prepare(`SELECT COUNT(*) AS tracked_count,
          SUM(CASE WHEN o.status = 'Pending' THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN o.status = 'NeedsReview' THEN 1 ELSE 0 END) AS needs_review_count,
          MAX(o.observed_at) AS last_observed_at
        FROM operations o JOIN companies c ON c.id = o.company_id
        WHERE c.network = 'testnet' AND c.contract_id = ?`).get(id) as {
          tracked_count: number; pending_count: number | null; needs_review_count: number | null; last_observed_at: string | null;
        };
      history = { coverage: "app-submitted-only", trackedCount: row.tracked_count,
        pendingCount: row.pending_count ?? 0, needsReviewCount: row.needs_review_count ?? 0,
        lastObservedAt: row.last_observed_at };
      const workerAudit = db.prepare(`SELECT state, ledger_revision, issues_json, last_error, checked_at
        FROM company_audits WHERE company_id = ?`).get(companyRowId) as {
          state: string; ledger_revision: number | null; issues_json: string; last_error: string | null; checked_at: string;
        } | undefined;
      if (workerAudit) history.lastWorkerAudit = { state: workerAudit.state,
        checkedRevision: workerAudit.ledger_revision, issues: JSON.parse(workerAudit.issues_json),
        lastError: workerAudit.last_error, checkedAt: workerAudit.checked_at };
    } catch {
      history = { coverage: "unavailable", error: "Local history database could not be read." };
    }
    return NextResponse.json({ network: "testnet", companyId: id, checkedAt: new Date().toISOString(),
      chain, audit, history }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Company chain read failed" }, { status: 502 });
  }
}
