import assert from "node:assert/strict";
import test from "node:test";
import { assessCompanyLedger } from "./company-health.ts";

const snapshot = () => ({
  config: { dao_id: "board.testnet", snapshot_operator_id: "operator.testnet", settlement_token_id: "testusd.testnet", authorized_units: "100", paused: false },
  totals: { dao_id: "board.testnet", authorized_units: "100", issued_total: "60", pool_available: "20", grant_reserved: "10", fully_diluted_total: "90", unallocated_units: "10", ledger_revision: 3, holder_count: 2 },
  holdings: [{ account_id: "alice.testnet", issued_units: "40" }, { account_id: "bob.testnet", issued_units: "20" }],
  grants: [{ id: 0, recipient: "bob.testnet", original_units: "20", entitlement_cap: "15", issued_units: "5", vested_units: "15", claimable_units: "10", boundaries: [], cancelled_at: null }],
  distributions: [{ id: 0, snapshot_revision: 3, snapshot_timestamp: 1, snapshot_block_height: 1, token_id: "testusd.testnet", budget: "7", expires_at: 9, schedule_hash: [], approved: true, cancelled: false, funded: true,
    paid_total: "5", in_flight_total: "0", available_escrow: "2", entitlements: [
      { account_id: "alice.testnet", units: "40", amount: "5", payment_status: "Paid", attempt_id: 1 },
      { account_id: "bob.testnet", units: "20", amount: "2", payment_status: "Failed", attempt_id: 1 },
    ] }],
  revisionAfter: 3,
});

test("audits the complete on-chain ledger and fixed payout accounting", () => {
  assert.deepEqual(assessCompanyLedger(snapshot()), { state: "Consistent", checkedRevision: 3, issues: [] });
  const tampered = snapshot();
  tampered.totals.issued_total = "61";
  tampered.distributions[0].available_escrow = "1";
  const audit = assessCompanyLedger(tampered);
  assert.equal(audit.state, "Inconsistent");
  assert.ok(audit.issues.some(issue => issue.includes("Issued units")));
  assert.ok(audit.issues.some(issue => issue.includes("escrow")));
  assert.equal(assessCompanyLedger({ ...snapshot(), revisionAfter: 4 }).state, "Inconclusive");
});
