import assert from "node:assert/strict";
import test from "node:test";
import { assessDemoDao, PINNED_SPUTNIK_CODE_HASH } from "./dao-policy.ts";

const policy = () => ({
  proposal_bond: "100000000000000000000000",
  roles: [{ name: "council", kind: { Group: ["a.testnet", "b.testnet", "c.testnet"] },
    permissions: ["*:VoteApprove"], vote_policy: {} }],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
});

test("requires the pinned DAO code and exact two-of-three council policy", () => {
  assert.equal(assessDemoDao(policy(), PINNED_SPUTNIK_CODE_HASH).verified, true);
  assert.equal(assessDemoDao(policy(), "different-hash").verified, false);
  assert.equal(assessDemoDao({ ...policy(), default_vote_policy: { ...policy().default_vote_policy, threshold: [1, 3] } }, PINNED_SPUTNIK_CODE_HASH).verified, false);
  assert.equal(assessDemoDao({ ...policy(), roles: [{ ...policy().roles[0], kind: { Group: ["a.testnet", "a.testnet", "c.testnet"] } }] }, PINNED_SPUTNIK_CODE_HASH).verified, false);
  assert.equal(assessDemoDao({ ...policy(), roles: [{ ...policy().roles[0], vote_policy: { "*:VoteApprove": { threshold: "1" } } }] }, PINNED_SPUTNIK_CODE_HASH).verified, false);
});
