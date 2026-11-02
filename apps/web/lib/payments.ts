import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { Account, JsonRpcProvider, teraToGas } from "near-api-js";
import { ensureCompany, getDatabase } from "./db";
import { type CompanyConfig, type Distribution, validAccountId, view } from "./near";
import { classifyPayment, markAbandonedClaimsForReview } from "./payment-state";

type Job = { company_id: string; contract_id: string; distribution_id: number; recipient_id: string; attempt_id: number; submission_state: string; tx_hash: string | null };

const distribution = (contractId: string, id: number) => view<Distribution | null>(contractId, "get_distribution", { distribution_id: id });

export async function enqueueDistribution(contractId: string, id: number) {
  if (!validAccountId(contractId) || !Number.isSafeInteger(id) || id < 0) throw new Error("Invalid distribution request");
  const [config, current] = await Promise.all([view<CompanyConfig>(contractId, "get_config"), distribution(contractId, id)]);
  if (config.paused || !current?.funded || current.cancelled) throw new Error("Distribution is not payable");
  const db = getDatabase();
  const companyId = ensureCompany(db, contractId, config.dao_id);
  const queued = db.transaction(() => {
    let count = 0;
    for (const row of current.entitlements) {
      if (!["Ready", "Failed"].includes(row.payment_status) || BigInt(row.amount) <= 0n) continue;
      const attemptId = row.attempt_id + 1;
      if (!Number.isSafeInteger(attemptId)) throw new Error("Payment attempt overflow");
      const unresolved = db.prepare(`SELECT 1 FROM payment_jobs WHERE company_id = ? AND distribution_id = ? AND recipient_id = ?
        AND submission_state IN ('Queued', 'Claimed', 'Submitted', 'NeedsReview') LIMIT 1`).get(companyId, id, row.account_id);
      if (unresolved) continue;
      count += db.prepare(`INSERT INTO payment_jobs (company_id, distribution_id, recipient_id, attempt_id, submission_state)
        VALUES (?, ?, ?, ?, 'Queued') ON CONFLICT DO NOTHING`).run(companyId, id, row.account_id, attemptId).changes;
    }
    return count;
  })();
  return { companyId, distributionId: id, queued };
}

function updateJob(db: Database.Database, job: Job, state: string, txHash: string | null = null, error: string | null = null) {
  db.prepare(`UPDATE payment_jobs SET submission_state = ?, tx_hash = COALESCE(?, tx_hash), last_error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE company_id = ? AND distribution_id = ? AND recipient_id = ? AND attempt_id = ?`)
    .run(state, txHash, error?.slice(0, 300) ?? null, job.company_id, job.distribution_id, job.recipient_id, job.attempt_id);
}

function claimOne(db: Database.Database): Job | undefined {
  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM payment_jobs WHERE submission_state IN ('Claimed', 'Submitted', 'NeedsReview') LIMIT 1").get()) return undefined;
    const job = db.prepare(`SELECT j.*, c.contract_id FROM payment_jobs j JOIN companies c ON c.id = j.company_id
      WHERE j.submission_state = 'Queued' ORDER BY j.updated_at, j.distribution_id, j.recipient_id LIMIT 1`).get() as Job | undefined;
    if (job) updateJob(db, job, "Claimed");
    return job;
  })();
}

export async function submitNextPayment() {
  const db = getDatabase();
  const job = claimOne(db);
  if (!job) return { submitted: false, reason: "No eligible job or payment awaiting settlement/review" };
  let signingStarted = false;
  try {
    const [config, current] = await Promise.all([view<CompanyConfig>(job.contract_id, "get_config"), distribution(job.contract_id, job.distribution_id)]);
    const row = current?.entitlements.find(item => item.account_id === job.recipient_id);
    if (!row || config.paused || !current?.funded || current.cancelled || !["Ready", "Failed"].includes(row.payment_status) || row.attempt_id + 1 !== job.attempt_id || BigInt(row.amount) <= 0n) {
      updateJob(db, job, "NeedsReview", null, "On-chain entitlement changed before submission");
      return { submitted: false, reason: "On-chain entitlement changed; review required" };
    }
    const accountId = process.env.CAPTAB_EXECUTOR_ACCOUNT_ID;
    const privateKey = process.env.CAPTAB_EXECUTOR_PRIVATE_KEY;
    if (!accountId || !validAccountId(accountId) || !privateKey) {
      updateJob(db, job, "Queued", null, "Executor credentials are not configured");
      return { submitted: false, reason: "Executor credentials are not configured" };
    }
    const account = new Account(accountId, new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org" }), privateKey as `ed25519:${string}`);
    signingStarted = true;
    const result = await account.callFunctionRaw({ contractId: job.contract_id, methodName: "pay_recipient",
      args: { distribution_id: job.distribution_id, recipient_id: job.recipient_id }, gas: teraToGas(90), deposit: 0n, waitUntil: "INCLUDED_FINAL" });
    const txHash = result.transaction.hash;
    db.transaction(() => {
      db.prepare(`INSERT INTO operations (id, company_id, network, tx_hash, signer_id, status)
        VALUES (?, ?, 'testnet', ?, ?, 'Pending') ON CONFLICT(network, tx_hash) DO NOTHING`).run(randomUUID(), job.company_id, txHash, accountId);
      updateJob(db, job, "Submitted", txHash);
    })();
    return { submitted: true, distributionId: job.distribution_id, recipientId: job.recipient_id, attemptId: job.attempt_id, txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment submission failed";
    updateJob(db, job, signingStarted ? "NeedsReview" : "Queued", null, message);
    return { submitted: false, reason: signingStarted ? "Submission outcome uncertain; review required" : message };
  }
}

export async function reconcilePaymentJobs() {
  const db = getDatabase();
  const abandoned = markAbandonedClaimsForReview(db);
  const jobs = db.prepare(`SELECT j.*, c.contract_id FROM payment_jobs j JOIN companies c ON c.id = j.company_id
    JOIN operations o ON o.network = 'testnet' AND o.tx_hash = j.tx_hash
    WHERE j.submission_state = 'Submitted' AND o.status IN ('Confirmed', 'Failed', 'NeedsReview')
    ORDER BY j.updated_at LIMIT 20`).all() as Job[];
  const results: { distributionId: number; recipientId: string; state: string }[] = abandoned.map(job => ({
    distributionId: job.distribution_id, recipientId: job.recipient_id, state: "NeedsReview",
  }));
  for (const job of jobs) {
    try {
      const current = await distribution(job.contract_id, job.distribution_id);
      const row = current?.entitlements.find(item => item.account_id === job.recipient_id);
      const state = row ? classifyPayment(job.attempt_id, row) : "NeedsReview";
      updateJob(db, job, state, null, state === "NeedsReview" ? "Final transaction did not settle the expected entitlement" : null);
      results.push({ distributionId: job.distribution_id, recipientId: job.recipient_id, state });
    } catch { /* Keep Submitted until the on-chain view is available. */ }
  }
  return results;
}
