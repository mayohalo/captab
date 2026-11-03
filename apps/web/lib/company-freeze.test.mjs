import assert from "node:assert/strict";
import test from "node:test";
import { assessCompanyFreeze, publicAccessKeys } from "./company-freeze.mjs";

const deployment = { publicKey: "ed25519:deployment", permission: "FullAccess" };
const functionCall = { publicKey: "ed25519:limited", permission: { FunctionCall: { receiver_id: "company.testnet", method_names: ["get_totals"] } } };
const input = {
  manifest: { network: "testnet", companyId: "company.testnet", company: {
    codeHash: "company-code", deploymentPublicKey: deployment.publicKey, remainingAccessKeys: [functionCall, deployment],
  } },
  codeHash: "company-code", accessKeys: [deployment, functionCall], deploymentPublicKey: deployment.publicKey,
};

test("freeze preflight accepts only the recorded last full-access key", () => {
  assert.deepEqual(assessCompanyFreeze(input), []);
  assert.deepEqual(publicAccessKeys({ keys: [{ public_key: deployment.publicKey, access_key: { permission: "FullAccess" } }] }), [deployment]);
});

test("freeze preflight rejects code, identity, key-list, and extra full-access drift", () => {
  const changed = structuredClone(input);
  changed.codeHash = "other-code";
  changed.deploymentPublicKey = "ed25519:other";
  changed.accessKeys.push({ publicKey: "ed25519:extra", permission: "FullAccess" });
  const issues = assessCompanyFreeze(changed).join(" ");
  for (const expected of ["identity", "code", "access keys", "only full-access key"]) {
    assert.match(issues, new RegExp(expected));
  }
});
