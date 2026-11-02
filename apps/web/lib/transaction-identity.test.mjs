import assert from "node:assert/strict";
import test from "node:test";
import { assertObservedTransaction } from "./transaction-identity.mjs";

const identity = { txHash: "known-hash", signerId: "alice.testnet", companyId: "company.testnet", daoId: "dao.testnet" };

test("included company and DAO transactions can be tracked", () => {
  for (const receiver_id of [identity.companyId, identity.daoId]) {
    assertObservedTransaction({ transaction: { hash: identity.txHash, signer_id: identity.signerId, receiver_id } }, identity);
  }
});

test("unknown, mismatched, or unrelated transactions never enter history", () => {
  assert.throws(() => assertObservedTransaction({}, identity), /identity mismatch/);
  assert.throws(() => assertObservedTransaction({ transaction: { hash: "other", signer_id: identity.signerId,
    receiver_id: identity.companyId } }, identity), /identity mismatch/);
  assert.throws(() => assertObservedTransaction({ transaction: { hash: identity.txHash, signer_id: "mallory.testnet",
    receiver_id: identity.companyId } }, identity), /identity mismatch/);
  assert.throws(() => assertObservedTransaction({ transaction: { hash: identity.txHash, signer_id: identity.signerId,
    receiver_id: "unrelated.testnet" } }, identity), /does not target/);
});
