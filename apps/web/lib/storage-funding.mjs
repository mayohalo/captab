// Schema v2: the NEAR Sandbox stress test measured 1,141,581 bytes with 100 holders, 200 grants, and 50
// 100-row distributions. The extra 108,419 bytes are an allowance for 200 deals and 20 rounds, which the
// stress test does not fill. Revisit after contract changes.
export const DEMO_STATE_GROWTH_BYTES = 1_250_000;
export const STORAGE_BUFFER_BYTES = 100_000;
export const GAS_HEADROOM_YOCTO = 10n ** 24n;

function nonnegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative safe integer`);
  return value;
}

export function assessCompanyFunding({ storageUsage, accountBalance, codeBytesToAdd, storagePricePerByte, stateGrowthBytes }) {
  const currentBytes = nonnegativeInteger(storageUsage, "storageUsage");
  const codeBytes = nonnegativeInteger(codeBytesToAdd, "codeBytesToAdd");
  const stateBytes = nonnegativeInteger(stateGrowthBytes, "stateGrowthBytes");
  const projectedBytes = currentBytes + codeBytes + stateBytes + STORAGE_BUFFER_BYTES;
  if (!Number.isSafeInteger(projectedBytes)) throw new Error("Projected storage exceeds a safe integer");
  const balance = BigInt(accountBalance);
  const price = BigInt(storagePricePerByte);
  if (balance < 0n || price <= 0n) throw new Error("Account balance and storage price must be valid");
  const requiredYocto = BigInt(projectedBytes) * price + GAS_HEADROOM_YOCTO;
  return {
    projectedBytes,
    currentBytes,
    codeBytes,
    stateBytes,
    bufferBytes: STORAGE_BUFFER_BYTES,
    storagePricePerByte: price.toString(),
    accountBalanceYocto: balance.toString(),
    requiredYocto: requiredYocto.toString(),
    shortfallYocto: (balance < requiredYocto ? requiredYocto - balance : 0n).toString(),
    funded: balance >= requiredYocto,
  };
}
