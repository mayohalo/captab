import assert from "node:assert/strict";
import { JsonRpcProvider, KeyPair } from "near-api-js";
import { removeCompanyDeploymentKey, publicAccessKeys } from "../lib/company-freeze.mjs";

const { SANDBOX_RPC_URL, SANDBOX_COMPANY_ID, SANDBOX_COMPANY_KEY } = process.env;
if (!SANDBOX_RPC_URL || !SANDBOX_COMPANY_ID || !SANDBOX_COMPANY_KEY) throw new Error("Sandbox freeze inputs are missing");
const provider = new JsonRpcProvider({ url: SANDBOX_RPC_URL });
const finalQuery = { finality: "final" };
const publicKey = KeyPair.fromString(SANDBOX_COMPANY_KEY).getPublicKey().toString();
const [beforeCode, beforeKeys] = await Promise.all([
  provider.viewContractCode({ contractId: SANDBOX_COMPANY_ID, blockQuery: finalQuery }),
  provider.viewAccessKeyList({ accountId: SANDBOX_COMPANY_ID, finalityQuery: finalQuery }),
]);
assert.deepEqual(publicAccessKeys(beforeKeys), [{ publicKey, permission: "FullAccess" }]);
const removed = await removeCompanyDeploymentKey({ provider, companyId: SANDBOX_COMPANY_ID,
  privateKey: SANDBOX_COMPANY_KEY, publicKey, expectedCodeHash: beforeCode.hash });
assert.deepEqual(removed.remainingAccessKeys, []);
assert.match(removed.txHash, /^[1-9A-HJ-NP-Za-km-z]{40,50}$/);
console.log(JSON.stringify({ companyId: SANDBOX_COMPANY_ID, codeHash: beforeCode.hash, keyRemoval: removed.txHash,
  remainingAccessKeys: removed.remainingAccessKeys }));
