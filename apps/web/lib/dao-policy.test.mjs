import assert from "node:assert/strict";
import test from "node:test";
import { assessDaoPolicy, councilMembers, councilRule, PINNED_SPUTNIK_CODE_HASH, requiredApprovals } from "./dao-policy.ts";

const council = (members, extra = {}) => ({ name: "council", kind: { Group: members },
  permissions: ["*:VoteApprove", "*:Finalize"], vote_policy: {}, ...extra });
const policy = (members = ["a.testnet", "b.testnet", "c.testnet"], threshold = [1, 2], roles = []) => ({
  proposal_bond: "100000000000000000000000",
  roles: [{ name: "all", kind: "Everyone", permissions: ["*:AddProposal"], vote_policy: {} }, council(members), ...roles],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold },
});
const assess = value => assessDaoPolicy(value, PINNED_SPUTNIK_CODE_HASH);

test("computes Sputnik's required approvals for ratio, weight, and quorum thresholds", () => {
  const vote = threshold => ({ weight_kind: "RoleWeight", quorum: "0", threshold });
  assert.equal(requiredApprovals(vote([1, 2]), 3), 2);
  assert.equal(requiredApprovals(vote([1, 2]), 4), 3);
  assert.equal(requiredApprovals(vote([1, 2]), 5), 3);
  assert.equal(requiredApprovals(vote([1, 3]), 3), 2);
  assert.equal(requiredApprovals(vote([1, 1]), 3), 3);
  assert.equal(requiredApprovals(vote("2"), 5), 2);
  assert.equal(requiredApprovals(vote("9"), 5), 5);
  assert.equal(requiredApprovals({ ...vote("1"), quorum: "3" }, 5), 3);
  assert.equal(requiredApprovals({ ...vote([1, 2]), weight_kind: "TokenWeight" }, 3), null);
  assert.equal(requiredApprovals(vote([1, 0]), 3), null);
});

test("accepts the deployed two-of-three policy and other majority councils", () => {
  assert.deepEqual(assess(policy()), { verified: true, rule: { members: 3, required: 2 },
    reason: "Pinned Sputnik code and 2 of 3 council approval verified." });
  assert.deepEqual(assess(policy(["a.testnet", "b.testnet", "c.testnet", "d.testnet", "e.testnet"])).rule, { members: 5, required: 3 });
  assert.equal(assess(policy(["a.testnet", "b.testnet", "c.testnet", "d.testnet", "e.testnet"])).verified, true);
  assert.equal(assess(policy(["solo.testnet"])).verified, true);
  assert.equal(assess(policy(["a.testnet", "b.testnet"], "2")).verified, true);
  assert.equal(assess(policy(undefined, [1, 3])).verified, true, "1/3 of three members still needs two votes");
});

test("rejects minority approval, other voters, overrides, duplicates, and unpinned code", () => {
  assert.equal(assessDaoPolicy(policy(), "different-hash").verified, false);
  assert.equal(assessDaoPolicy(null, PINNED_SPUTNIK_CODE_HASH).verified, false);
  const minority = assess(policy(["a.testnet", "b.testnet", "c.testnet", "d.testnet", "e.testnet"], "2"));
  assert.equal(minority.verified, false);
  assert.match(minority.reason, /2 of 5/);
  assert.equal(assess(policy(["a.testnet", "b.testnet"], "1")).verified, false, "one of two is not a majority");
  assert.equal(assess(policy(["a.testnet", "a.testnet", "c.testnet"])).verified, false);
  assert.equal(assess(policy([])).verified, false);
  const overridden = policy();
  overridden.roles[1] = council(["a.testnet", "b.testnet", "c.testnet"], { vote_policy: { call: { threshold: "1" } } });
  assert.equal(assess(overridden).verified, false);
  const noApprove = policy();
  noApprove.roles[1] = council(["a.testnet", "b.testnet", "c.testnet"], { permissions: ["*:AddProposal"] });
  assert.equal(assess(noApprove).verified, false);
  for (const permission of ["*:VoteApprove", "call:VoteReject", "*:*", "call:*"]) {
    const outsider = policy(undefined, [1, 2], [{ name: "observers", kind: { Group: ["mallory.testnet"] }, permissions: [permission], vote_policy: {} }]);
    assert.equal(assess(outsider).verified, false, permission);
  }
  const tokenWeighted = policy();
  tokenWeighted.default_vote_policy.weight_kind = "TokenWeight";
  assert.equal(assess(tokenWeighted).verified, false);
});

test("council helpers read only a group council", () => {
  assert.deepEqual(councilMembers(policy()), ["a.testnet", "b.testnet", "c.testnet"]);
  assert.deepEqual(councilMembers({ proposal_bond: "0", roles: [{ name: "council", kind: "Everyone" }] }), []);
  assert.equal(councilRule(null), null);
});
