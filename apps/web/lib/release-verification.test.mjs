import assert from "node:assert/strict";
import test from "node:test";
import { assertReleaseCompanyWasm, assessRelease } from "./release-verification.mjs";

const limits = { max_holders: 20, max_grants: 100, max_distributions: 20, max_actions: 200, vesting_boundaries: 49 };
const vote = { weight_kind: "RoleWeight", quorum: "0", threshold: { Ratio: [1, 2] } };
const members = ["a.testnet", "b.testnet", "c.testnet"];
const artifact = (name) => ({ sha256: `${name}-sha`, codeHash: `${name}-code` });
const snapshot = {
  manifest: {
    network: "testnet", companyId: "company.testnet", daoId: "dao.testnet", operatorId: "operator.testnet", tokenId: "token.testnet",
    company: { ...artifact("company"), authorizedUnits: "1000", schemaVersion: 1, limits,
      remainingAccessKeys: [{ publicKey: "ed25519:key", permission: "FullAccess" }] },
    dao: { ...artifact("dao"), sourceCommit: "5434a59dec23ee0c49df8c8c4350c208a7e75b0b",
      sha256: "a6055ab340bb5b9909ce4ff4bc7d2ae365b77d7b4b74d481fc2d2ee97c8a0722", council: members, defaultVotePolicy: vote,
      policy: { roles: [{ name: "council", kind: { Group: members }, permissions: ["*:VoteApprove"], vote_policy: {} }], default_vote_policy: vote, proposal_bond: "100" } },
    token: { ...artifact("token"), symbol: "TESTUSD", decimals: 6, totalSupply: "100000000000", storageRegistration: "registered" },
  },
  artifacts: { company: artifact("company"), dao: {
    sha256: "a6055ab340bb5b9909ce4ff4bc7d2ae365b77d7b4b74d481fc2d2ee97c8a0722", codeHash: "dao-code",
  }, token: artifact("token") },
  chain: {
    companyCodeHash: "company-code", daoCodeHash: "dao-code", tokenCodeHash: "token-code",
    policy: { roles: [{ name: "council", kind: { Group: members }, permissions: ["*:VoteApprove"], vote_policy: {} }], default_vote_policy: vote, proposal_bond: "100" },
    tokenMetadata: { spec: "ft-1.0.0", symbol: "TESTUSD", decimals: 6 },
    tokenSupply: "100000000000",
    config: { schema_version: 1, dao_id: "dao.testnet", snapshot_operator_id: "operator.testnet",
      settlement_token_id: "token.testnet", authorized_units: "1000", limits },
    totals: { dao_id: "dao.testnet", authorized_units: "1000", issued_total: "600", pool_available: "200",
      grant_reserved: "100", fully_diluted_total: "900", unallocated_units: "100" },
    storageBalance: { total: "1250000000000000000000" },
    accessKeys: [{ publicKey: "ed25519:key", permission: "FullAccess" }],
  },
  funding: { funded: true },
};

test("frozen release evidence accepts matching artifacts, policy, ledger, registration, and keys", () => {
  assert.deepEqual(assessRelease(snapshot), []);
});

test("release check reports independent code, policy, accounting, key, and funding drift", () => {
  const changed = structuredClone(snapshot);
  changed.chain.companyCodeHash = "replaced-code";
  changed.chain.policy.roles[0].kind.Group = ["a.testnet", "b.testnet", "mallory.testnet"];
  changed.chain.totals.fully_diluted_total = "901";
  changed.chain.accessKeys = [];
  changed.funding.funded = false;
  const issues = assessRelease(changed).join(" ");
  for (const expected of ["deployed code", "DAO council", "supply accounting", "access keys", "balance"]) {
    assert.match(issues, new RegExp(expected));
  }
});

test("release check catches DAO policy drift outside council voting", () => {
  const changed = structuredClone(snapshot);
  changed.chain.policy.proposal_bond = "101";
  assert.match(assessRelease(changed).join(" "), /DAO full policy differs/);
  changed.chain.policy.proposal_bond = "100";
  changed.chain.policy.roles.push({ name: "extra", kind: "Everyone", permissions: ["*:AddProposal"], vote_policy: {} });
  assert.match(assessRelease(changed).join(" "), /DAO full policy differs/);
});

test("release check catches settlement-token supply drift", () => {
  const changed = structuredClone(snapshot);
  changed.chain.tokenSupply = "99999999999";
  assert.match(assessRelease(changed).join(" "), /total supply differs/);
});

test("fault-injection WASM cannot pass release artifact checks", () => {
  assert.doesNotThrow(() => assertReleaseCompanyWasm(Buffer.from("ordinary release contract")));
  assert.throws(() => assertReleaseCompanyWasm(Buffer.from("sandbox-injected payment callback failure")), /Fault-injection company WASM/);
});
