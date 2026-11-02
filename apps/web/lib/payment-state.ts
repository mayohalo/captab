import type Database from "better-sqlite3";

export type PaymentObservation = { attempt_id: number; payment_status: "Ready" | "InFlight" | "Failed" | "Paid" | "Zero" };

export function classifyPayment(attemptId: number, row: PaymentObservation): "Settled" | "Failed" | "NeedsReview" {
  if (row.attempt_id !== attemptId) return "NeedsReview";
  return row.payment_status === "Paid" ? "Settled" : row.payment_status === "Failed" ? "Failed" : "NeedsReview";
}

type ClaimedJob = { company_id: string; distribution_id: number; recipient_id: string; attempt_id: number };

/** Only changes local observation state. It never requeues or retries an uncertain transfer. */
export function markAbandonedClaimsForReview(db: Database.Database, afterSeconds = 120): ClaimedJob[] {
  if (!Number.isSafeInteger(afterSeconds) || afterSeconds < 1) throw new Error("Invalid claim review age");
  return db.transaction(() => {
    const rows = db.prepare(`SELECT company_id, distribution_id, recipient_id, attempt_id FROM payment_jobs
      WHERE submission_state = 'Claimed' AND updated_at <= datetime('now', ?)
      ORDER BY updated_at`).all(`-${afterSeconds} seconds`) as ClaimedJob[];
    const update = db.prepare(`UPDATE payment_jobs SET submission_state = 'NeedsReview',
      last_error = 'Worker claim became stale; submission outcome is unknown', updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ? AND distribution_id = ? AND recipient_id = ? AND attempt_id = ? AND submission_state = 'Claimed'`);
    for (const row of rows) update.run(row.company_id, row.distribution_id, row.recipient_id, row.attempt_id);
    return rows;
  })();
}
