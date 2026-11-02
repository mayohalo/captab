import type Database from "better-sqlite3";
import { assessCompanyLedger } from "./company-health";
import { readCompany, type Totals, view } from "./near";

type DueCompany = { id: string; contract_id: string };

export async function auditKnownCompanies(db: Database.Database) {
  const due = db.prepare(`SELECT c.id, c.contract_id FROM companies c
    LEFT JOIN company_audits a ON a.company_id = c.id
    WHERE a.checked_at IS NULL OR a.checked_at <= datetime('now', '-5 minutes')
    ORDER BY a.checked_at, c.created_at LIMIT 2`).all() as DueCompany[];
  const results: { contractId: string; state: string; issues: string[] }[] = [];
  for (const company of due) {
    let state: string;
    let revision: number | null = null;
    let issues: string[];
    let lastError: string | null = null;
    try {
      const chain = await readCompany(company.contract_id);
      const revisionAfter = (await view<Totals>(company.contract_id, "get_totals")).ledger_revision;
      const audit = assessCompanyLedger({ ...chain, revisionAfter });
      state = audit.state;
      revision = audit.checkedRevision;
      issues = audit.issues;
    } catch (error) {
      state = "Unavailable";
      lastError = (error instanceof Error ? error.message : "Chain read failed").slice(0, 300);
      issues = ["Chain views could not be read; retry after RPC recovery."];
    }
    db.prepare(`INSERT INTO company_audits (company_id, state, ledger_revision, issues_json, last_error, checked_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(company_id) DO UPDATE SET state = excluded.state, ledger_revision = excluded.ledger_revision,
        issues_json = excluded.issues_json, last_error = excluded.last_error, checked_at = CURRENT_TIMESTAMP`)
      .run(company.id, state, revision, JSON.stringify(issues), lastError);
    results.push({ contractId: company.contract_id, state, issues });
  }
  return results;
}
