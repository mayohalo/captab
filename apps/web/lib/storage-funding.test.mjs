import assert from "node:assert/strict";
import test from "node:test";
import { assessCompanyFunding, GAS_HEADROOM_YOCTO } from "./storage-funding.mjs";

test("new account needs code, bounded demo state, storage buffer, and transaction headroom", () => {
  const price = 10n ** 19n;
  const projectedBytes = 182 + 403_976 + 114_320 + 100_000;
  const required = BigInt(projectedBytes) * price + GAS_HEADROOM_YOCTO;
  const result = assessCompanyFunding({ storageUsage: 182, accountBalance: (required - 1n).toString(),
    codeBytesToAdd: 403_976, stateGrowthBytes: 114_320, storagePricePerByte: price.toString() });
  assert.equal(result.projectedBytes, projectedBytes);
  assert.equal(result.requiredYocto, required.toString());
  assert.equal(result.shortfallYocto, "1");
  assert.equal(result.funded, false);
});

test("existing code is not charged again and exact required balance passes", () => {
  const price = 10n ** 19n;
  const required = BigInt(500_000 + 100_000) * price + GAS_HEADROOM_YOCTO;
  const result = assessCompanyFunding({ storageUsage: 500_000, accountBalance: required.toString(),
    codeBytesToAdd: 0, stateGrowthBytes: 0, storagePricePerByte: price.toString() });
  assert.equal(result.projectedBytes, 600_000);
  assert.equal(result.shortfallYocto, "0");
  assert.equal(result.funded, true);
});

test("invalid usage and protocol price fail closed", () => {
  const input = { storageUsage: 0, accountBalance: "10", codeBytesToAdd: 0, stateGrowthBytes: 0, storagePricePerByte: "1" };
  assert.throws(() => assessCompanyFunding({ ...input, codeBytesToAdd: -1 }), /codeBytesToAdd/);
  assert.throws(() => assessCompanyFunding({ ...input, storagePricePerByte: "0" }), /valid/);
});
