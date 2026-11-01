import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureCompany, openDatabase } from "./db.ts";
import { parseCaptabEvents, persistFinalTransaction } from "./receipts.ts";

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
  } finally { db.close(); }
});
