import type Database from "better-sqlite3";
import type { DaoProposal } from "./near";
import { proposalPayloadHash } from "./receipts.ts";

type TrackedProposal = {
  dao_id: string;
  proposal_id: number;
  payload_hash: string;
  observed_status: string;
};

/** A DAO status is governance state; final company execution still requires receipt evidence. */
export async function reconcileTrackedProposals(
  db: Database.Database,
  readProposal: (daoId: string, id: number) => Promise<DaoProposal>,
) {
  const rows = db.prepare(`SELECT dao_id, proposal_id, payload_hash, observed_status FROM proposals
    WHERE observed_status IN ('Submitted', 'InProgress')
      AND (last_checked_at IS NULL OR last_checked_at <= datetime('now', '-30 seconds'))
    ORDER BY last_checked_at LIMIT 20`).all() as TrackedProposal[];
  const results: { daoId: string; proposalId: number; status: string; error?: string }[] = [];
  for (const row of rows) {
    db.prepare("UPDATE proposals SET last_checked_at = CURRENT_TIMESTAMP WHERE network = 'testnet' AND dao_id = ? AND proposal_id = ?")
      .run(row.dao_id, row.proposal_id);
    try {
      const proposal = await readProposal(row.dao_id, row.proposal_id);
      const status = proposalPayloadHash(proposal) !== row.payload_hash ? "NeedsReview" : proposal.status;
      if (typeof status !== "string" || !status) throw new Error("DAO proposal returned no status");
      db.prepare("UPDATE proposals SET observed_status = ? WHERE network = 'testnet' AND dao_id = ? AND proposal_id = ?")
        .run(status, row.dao_id, row.proposal_id);
      results.push({ daoId: row.dao_id, proposalId: row.proposal_id, status });
    } catch (error) {
      results.push({ daoId: row.dao_id, proposalId: row.proposal_id, status: row.observed_status,
        error: error instanceof Error ? error.message : "DAO read failed" });
    }
  }
  return results;
}
