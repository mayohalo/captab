import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { ensureCompany, openDatabase } from "./db.ts";
import { classifyFinalTransaction, extractSubmittedProposal, parseCaptabEvents, persistFinalTransaction, proposalPayloadHash } from "./receipts.ts";
import { reconcileTrackedProposals } from "./proposal-observer.ts";

const result = {
  final_execution_status: "FINAL",
  status: { SuccessValue: "" },
  transaction: { hash: "tx-1", signer_id: "member.testnet" },
  receipts_outcome: [
    { id: "dao-receipt", block_hash: "block-a", outcome: { executor_id: "dao.testnet", logs: ["DAO approved"], status: { SuccessValue: "" } } },
    { id: "company-receipt", block_hash: "block-b", outcome: { executor_id: "company.testnet", logs: [
      "ordinary log",
      'EVENT_JSON:{"standard":"captable","version":"1.0.0","event":"grant_claimed","data":[{"grant_id":0,"units":"25"}]}',
      "EVENT_JSON:not-json",
    ], status: { SuccessValue: "" } } },
  ],
};

test("event parser only accepts company-owned structured logs", () => {
  const events = parseCaptabEvents(result.receipts_outcome, "company.testnet");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    receiptId: "company-receipt", logIndex: 1, eventName: "grant_claimed", version: "1.0.0",
    payload: [{ grant_id: 0, units: "25" }],
  });
});

test("failed company receipts never produce activity events or a confirmed operation", () => {
  const failedCompany = { ...result, receipts_outcome: [result.receipts_outcome[0], {
    ...result.receipts_outcome[1], outcome: { ...result.receipts_outcome[1].outcome, status: { Failure: { ActionError: "stale revision" } } },
  }] };
  assert.deepEqual(parseCaptabEvents(failedCompany.receipts_outcome, "company.testnet"), []);
  const unknownCompanyReceipt = { ...result.receipts_outcome[1], outcome: {
    ...result.receipts_outcome[1].outcome, status: {},
  } };
  assert.deepEqual(parseCaptabEvents([unknownCompanyReceipt], "company.testnet"), []);
  assert.equal(classifyFinalTransaction({ ...result, receipts_outcome: [unknownCompanyReceipt] }, "company.testnet"), "NeedsReview");
  assert.equal(classifyFinalTransaction(failedCompany, "company.testnet"), "NeedsReview");
  assert.equal(classifyFinalTransaction({ ...result, status: { Failure: { ActionError: "rejected" } } }, "company.testnet"), "Failed");
  assert.equal(classifyFinalTransaction({ ...result, status: {} }, "company.testnet"), "NeedsReview");
  const db = openDatabase(":memory:");
  try {
    const companyId = ensureCompany(db, "company.testnet", "dao.testnet");
    db.prepare("INSERT INTO operations (id, company_id, network, tx_hash, signer_id, status) VALUES (?, ?, 'testnet', ?, ?, 'Pending')")
      .run("operation-failed-receipt", companyId, "tx-1", "member.testnet");
    const observed = persistFinalTransaction(db, { operationId: "operation-failed-receipt", companyId,
      contractId: "company.testnet", txHash: "tx-1", signerId: "member.testnet", result: failedCompany });
    assert.deepEqual(observed, { status: "NeedsReview", receipts: 2, events: 0 });
    assert.equal(db.prepare("SELECT count(*) AS count FROM chain_events").get().count, 0);
  } finally { db.close(); }
});

test("final receipt observations persist idempotently and reject mismatched identity", () => {
  const db = openDatabase(":memory:");
  try {
    const companyId = ensureCompany(db, "company.testnet", "dao.testnet");
    db.prepare("INSERT INTO operations (id, company_id, network, tx_hash, signer_id, status) VALUES (?, ?, 'testnet', ?, ?, 'Pending')")
      .run("operation-1", companyId, "tx-1", "member.testnet");
    const params = { operationId: "operation-1", companyId, contractId: "company.testnet", txHash: "tx-1", signerId: "member.testnet", result };
    assert.deepEqual(persistFinalTransaction(db, params), { status: "Confirmed", receipts: 2, events: 1 });
    persistFinalTransaction(db, params);
    assert.equal(db.prepare("SELECT count(*) AS count FROM receipt_observations").get().count, 2);
    assert.equal(db.prepare("SELECT count(*) AS count FROM chain_events").get().count, 1);
    assert.equal(db.prepare("SELECT status FROM operations WHERE id = ?").get("operation-1").status, "Confirmed");
    assert.throws(() => persistFinalTransaction(db, { ...params, signerId: "attacker.testnet" }), /identity mismatch/);
    assert.throws(() => persistFinalTransaction(db, { ...params, result: { ...result, final_execution_status: "EXECUTED" } }), /finality/);
    assert.throws(() => persistFinalTransaction(db, { ...params, result: { ...result, transaction: { ...result.transaction, receiver_id: "other.testnet" },
      receipts_outcome: [{ id: "unrelated", block_hash: "block-c", outcome: { executor_id: "other.testnet", logs: [], status: { SuccessValue: "" } } }] } }), /no company or DAO execution evidence/);
  } finally { db.close(); }
});

test("finalized DAO proposal is linked to its company and action ID", () => {
  const db = openDatabase(":memory:");
  try {
    const companyId = ensureCompany(db, "company.testnet", "dao.testnet");
    db.prepare("INSERT INTO operations (id, company_id, network, tx_hash, signer_id, status) VALUES (?, ?, 'testnet', ?, ?, 'Pending')")
      .run("operation-2", companyId, "tx-2", "member.testnet");
    const proposal = { description: "Issue units", kind: { FunctionCall: { receiver_id: "company.testnet", actions: [{
      method_name: "issue_founder_units", args: Buffer.from(JSON.stringify({ action_id: "action-7", expected_revision: 1, recipient: "founder.testnet", units: "100" })).toString("base64"),
      gas: "40000000000000", deposit: "0",
    }] } } };
    const submitted = { ...result, transaction: { hash: "tx-2", signer_id: "member.testnet", receiver_id: "dao.testnet", actions: [{ FunctionCall: {
      method_name: "add_proposal", args: Buffer.from(JSON.stringify({ proposal })).toString("base64"),
    } }] }, status: { SuccessValue: Buffer.from("7").toString("base64") } };
    assert.deepEqual(extractSubmittedProposal(submitted, "dao.testnet", "company.testnet")?.proposalId, 7);
    assert.equal(extractSubmittedProposal(submitted, "other-dao.testnet", "company.testnet"), null);
    assert.equal(extractSubmittedProposal(submitted, "dao.testnet", "other-company.testnet"), null);
    persistFinalTransaction(db, { operationId: "operation-2", companyId, contractId: "company.testnet", txHash: "tx-2", signerId: "member.testnet", result: submitted });
    persistFinalTransaction(db, { operationId: "operation-2", companyId, contractId: "company.testnet", txHash: "tx-2", signerId: "member.testnet", result: submitted });
    const row = db.prepare("SELECT dao_id, proposal_id, company_id, submission_tx_hash, action_id, payload_hash, observed_status FROM proposals").get();
    assert.equal(row.dao_id, "dao.testnet");
    assert.equal(row.proposal_id, 7);
    assert.equal(row.company_id, companyId);
    assert.equal(row.submission_tx_hash, "tx-2");
    assert.equal(row.action_id, "action-7");
    assert.match(row.payload_hash, /^[a-f0-9]{64}$/);
    assert.equal(row.observed_status, "Submitted");
    assert.equal(db.prepare("SELECT count(*) AS count FROM proposals").get().count, 1);
  } finally { db.close(); }
});

test("tracked proposal status follows matching DAO payload and flags changed payload", async () => {
  const db = openDatabase(":memory:");
  try {
    const companyId = ensureCompany(db, "company.testnet", "dao.testnet");
    const proposal = { description: "Issue units", kind: { FunctionCall: { receiver_id: "company.testnet", actions: [] } } };
    db.prepare(`INSERT INTO proposals (network, dao_id, proposal_id, company_id, payload_hash, observed_status, last_checked_at)
      VALUES ('testnet', 'dao.testnet', 3, ?, ?, 'Submitted', datetime('now', '-31 seconds'))`)
      .run(companyId, proposalPayloadHash(proposal));
    const first = await reconcileTrackedProposals(db, async () => ({ ...proposal, status: "InProgress" }));
    assert.equal(first[0].status, "InProgress");
    db.prepare("UPDATE proposals SET last_checked_at = datetime('now', '-31 seconds') WHERE proposal_id = 3").run();
    const second = await reconcileTrackedProposals(db, async () => ({ ...proposal, description: "Changed", status: "Approved" }));
    assert.equal(second[0].status, "NeedsReview");
    assert.equal(db.prepare("SELECT observed_status FROM proposals WHERE proposal_id = 3").get().observed_status, "NeedsReview");
  } finally { db.close(); }
});

test("token funding proposal is linked through its fixed company receiver", () => {
  const funding = { description: "Fund distribution", kind: { FunctionCall: { receiver_id: "testusd.testnet", actions: [{
    method_name: "ft_transfer_call", args: Buffer.from(JSON.stringify({ receiver_id: "company.testnet", amount: "100", msg: "{}" })).toString("base64"),
  }] } } };
  const submitted = { ...result, transaction: { ...result.transaction, receiver_id: "dao.testnet", actions: [{ FunctionCall: {
    method_name: "add_proposal", args: Buffer.from(JSON.stringify({ proposal: funding })).toString("base64"),
  } }] }, status: { SuccessValue: Buffer.from("8").toString("base64") } };
  assert.equal(extractSubmittedProposal(submitted, "dao.testnet", "company.testnet")?.proposalId, 8);
  assert.equal(extractSubmittedProposal(submitted, "dao.testnet", "company.testnet")?.actionId, null);
  assert.equal(extractSubmittedProposal(submitted, "dao.testnet", "other.testnet"), null);
});

test("existing proposal database gains tracking columns without losing rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "captab-proposal-migration-"));
  const filename = join(directory, "captab.sqlite");
  const legacy = new Database(filename);
  try {
    legacy.exec(`CREATE TABLE proposals (network TEXT NOT NULL, dao_id TEXT NOT NULL, proposal_id INTEGER NOT NULL,
      action_id TEXT, payload_hash TEXT, observed_status TEXT NOT NULL, last_checked_at TEXT,
      PRIMARY KEY(network, dao_id, proposal_id));
      INSERT INTO proposals (network, dao_id, proposal_id, observed_status) VALUES ('testnet', 'dao.testnet', 4, 'InProgress');`);
  } finally { legacy.close(); }
  try {
    const db = openDatabase(filename);
    try {
      const row = db.prepare("SELECT company_id, submission_tx_hash, observed_status FROM proposals WHERE proposal_id = 4").get();
      assert.deepEqual(row, { company_id: null, submission_tx_hash: null, observed_status: "InProgress" });
    } finally { db.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
