import type Database from "better-sqlite3";

export function reserveSponsorRequest(db: Database.Database, request: {
  digest: string; companyId: string; accountId: string; grantId: number; gas: bigint;
}) {
  db.transaction(() => {
    const perAccount = db.prepare("SELECT COUNT(*) AS count FROM sponsor_requests WHERE account_id = ? AND created_at >= datetime('now', '-1 hour')")
      .get(request.accountId) as { count: number };
    const global = db.prepare("SELECT COUNT(*) AS count FROM sponsor_requests WHERE created_at >= datetime('now', '-1 day')")
      .get() as { count: number };
    if (perAccount.count >= 3 || global.count >= 100) throw new Error("Sponsorship rate limit reached");
    db.prepare(`INSERT INTO sponsor_requests (delegate_digest, company_id, account_id, grant_id, gas_budget, deposit_budget, outcome)
      VALUES (?, ?, ?, ?, ?, '0', 'Reserved')`).run(request.digest, request.companyId, request.accountId, request.grantId, request.gas.toString());
  })();
}
