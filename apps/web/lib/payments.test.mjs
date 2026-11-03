import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, ensureCompany } from "./db.ts";
import { classifyPayment, markAbandonedClaimsForReview } from "./payment-state.ts";

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

test("abandoned worker claims become review-only without creating another attempt", () => {
  const db = openDatabase(":memory:");
  try {
    const companyId = ensureCompany(db, "company.testnet", "dao.testnet");
    db.prepare(`INSERT INTO payment_jobs (company_id, distribution_id, recipient_id, attempt_id, submission_state, updated_at)
      VALUES (?, 7, 'alice.testnet', 1, 'Claimed', datetime('now', '-121 seconds'))`).run(companyId);
    db.prepare(`INSERT INTO payment_jobs (company_id, distribution_id, recipient_id, attempt_id, submission_state)
      VALUES (?, 7, 'bob.testnet', 1, 'Claimed')`).run(companyId);
    assert.deepEqual(markAbandonedClaimsForReview(db), [{ company_id: companyId, distribution_id: 7,
      recipient_id: "alice.testnet", attempt_id: 1 }]);
    assert.deepEqual(markAbandonedClaimsForReview(db), []);
    const rows = db.prepare("SELECT recipient_id, attempt_id, submission_state, last_error FROM payment_jobs ORDER BY recipient_id").all();
    assert.equal(rows[0].submission_state, "NeedsReview");
    assert.match(rows[0].last_error, /submission outcome is unknown/);
    assert.equal(rows[1].submission_state, "Claimed");
    assert.equal(rows.length, 2);
  } finally { db.close(); }
});

test("a worker restart preserves a stale claim for review across processes", () => {
  const directory = mkdtempSync(join(tmpdir(), "captab-worker-restart-"));
  const filename = join(directory, "jobs.sqlite");
  const dbModule = JSON.stringify(new URL("./db.ts", import.meta.url).href);
  const stateModule = JSON.stringify(new URL("./payment-state.ts", import.meta.url).href);
  const runProcess = source => {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source, filename], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  };
  try {
    runProcess(`
      import { openDatabase, ensureCompany } from ${dbModule};
      const db = openDatabase(process.argv[1]);
      const companyId = ensureCompany(db, "company.testnet", "dao.testnet");
      db.prepare("INSERT INTO payment_jobs (company_id, distribution_id, recipient_id, attempt_id, submission_state, updated_at) VALUES (?, 7, 'alice.testnet', 1, 'Claimed', datetime('now', '-121 seconds'))").run(companyId);
      db.close();
    `);
    runProcess(`
      import assert from "node:assert/strict";
      import { openDatabase } from ${dbModule};
      import { markAbandonedClaimsForReview } from ${stateModule};
      const db = openDatabase(process.argv[1]);
      assert.equal(markAbandonedClaimsForReview(db).length, 1);
      const rows = db.prepare("SELECT attempt_id, submission_state, tx_hash FROM payment_jobs").all();
      assert.deepEqual(rows, [{ attempt_id: 1, submission_state: "NeedsReview", tx_hash: null }]);
      db.close();
    `);
    runProcess(`
      import assert from "node:assert/strict";
      import { openDatabase } from ${dbModule};
      import { markAbandonedClaimsForReview } from ${stateModule};
      const db = openDatabase(process.argv[1]);
      assert.deepEqual(markAbandonedClaimsForReview(db), []);
      assert.equal(db.prepare("SELECT count(*) AS count FROM payment_jobs WHERE submission_state = 'NeedsReview'").get().count, 1);
      db.close();
    `);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
