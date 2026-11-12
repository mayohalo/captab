import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDistributionHash, distributionHash } from "./distribution-hash.ts";

const expected = "ecd5b5989bcf9bf50485085e99f4425d7e973842edcaaecf5cc000bd1fce22eb";
const distribution = () => ({
  id: 1, snapshot_revision: 4, snapshot_timestamp: 1_790_000_001, snapshot_block_height: 124,
  token_id: "testusd.testnet", budget: "100", expires_at: 1_900_000_000,
  schedule_hash: [...Buffer.from(expected, "hex")], approved: false, cancelled: false, funded: false,
  paid_total: "0", in_flight_total: "0", available_escrow: "0",
  entitlements: [
    { account_id: "founder-a.testnet", units: "3600000", amount: "60", payment_status: "Ready", attempt_id: 0 },
    { account_id: "founder-b.testnet", units: "2400000", amount: "40", payment_status: "Ready", attempt_id: 0 },
    { account_id: "contributor.testnet", units: "25000", amount: "0", payment_status: "Zero", attempt_id: 0 },
  ],
});

test("distribution Borsh hash matches the Rust vector and rejects changed entitlements", () => {
  const value = distribution();
  assert.equal(Buffer.from(distributionHash("company.testnet", value)).toString("hex"), expected);
  assert.doesNotThrow(() => assertDistributionHash("company.testnet", value));
  value.entitlements[0].amount = "61";
  assert.throws(() => assertDistributionHash("company.testnet", value), /schedule hash/);
});

test("distribution hash matches the contract-generated snapshot", () => {
  const value = distribution();
  value.id = 0;
  const expectedFromContract = "6e0c40b35adae6decb3ce471e540fc42cbd0935abd4e3d37af2fe9d4ed491a5c";
  value.schedule_hash = [...Buffer.from(expectedFromContract, "hex")];
  assert.equal(Buffer.from(distributionHash("company.testnet", value)).toString("hex"), expectedFromContract);
  assert.doesNotThrow(() => assertDistributionHash("company.testnet", value));
});

test("explicit payout lists hash under their own domain, matching the Rust contract", () => {
  const value = { ...distribution(), kind: "Explicit" };
  const explicit = "51cc8f9ff6691a66047262d2e38515567f978524cb951f9032a9b7a0254715a4";
  assert.equal(Buffer.from(distributionHash("company.testnet", value)).toString("hex"), explicit);
  assert.notEqual(explicit, expected, "the same rows hash differently as pro rata and explicit");
});
