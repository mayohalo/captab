import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase, ensureCompany } from "./db.ts";
import { classifyPayment } from "./payment-state.ts";

test("payment observation requires the exact on-chain attempt", () => {
  const row = { account_id: "alice.testnet", units: "1", amount: "100", attempt_id: 2, payment_status: "Paid" };
  assert.equal(classifyPayment(2, row), "Settled");
  assert.equal(classifyPayment(1, row), "NeedsReview");
  assert.equal(classifyPayment(2, { ...row, payment_status: "Failed" }), "Failed");
  assert.equal(classifyPayment(2, { ...row, payment_status: "InFlight" }), "NeedsReview");
  assert.equal(classifyPayment(2, { ...row, payment_status: "Ready" }), "NeedsReview");
});

test("payment queue preserves one row per recipient and attempt", () => {
  const db = openDatabase(":memory:");
  try {
    const companyId = ensureCompany(db, "company.testnet", "dao.testnet");
    const insert = db.prepare(`INSERT INTO payment_jobs (company_id, distribution_id, recipient_id, attempt_id, submission_state)
      VALUES (?, 7, 'alice.testnet', 1, 'Queued')`);
    insert.run(companyId);
    assert.throws(() => insert.run(companyId), /UNIQUE constraint failed/);
    db.prepare("UPDATE payment_jobs SET submission_state = 'Failed', last_error = ? WHERE company_id = ?").run("confirmed token failure", companyId);
    const row = db.prepare("SELECT submission_state, last_error FROM payment_jobs WHERE company_id = ?").get(companyId);
    assert.deepEqual(row, { submission_state: "Failed", last_error: "confirmed token failure" });
  } finally { db.close(); }
});
