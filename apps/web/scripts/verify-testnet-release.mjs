import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, baseEncode } from "near-api-js";
import { assessCompanyFunding } from "../lib/storage-funding.mjs";
import { assertReleaseCompanyWasm, assessRelease } from "../lib/release-verification.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
try { process.loadEnvFile(resolve(root, "apps/web/.env.local")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
const manifest = JSON.parse(await readFile(resolve(root, "docs/deployment-manifest.testnet.json"), "utf8"));
const paths = {
  company: "target/wasm32-unknown-unknown/release/captab_company.wasm",
  dao: ".cache/sputnik/target/wasm32-unknown-unknown/release/sputnikdao2.wasm",
  token: "target/wasm32-unknown-unknown/release/captab_test_token.wasm",
};
const artifacts = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => {
  const bytes = await readFile(resolve(root, path));
  if (name === "company") assertReleaseCompanyWasm(bytes);
  const digest = createHash("sha256").update(bytes).digest();
  return [name, { sha256: digest.toString("hex"), codeHash: baseEncode(digest) }];
})));
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com" });
const finalQuery = { finality: "final" };
if (await provider.getNetworkId() !== "testnet") throw new Error("RPC endpoint is not NEAR testnet");
const [companyCode, daoCode, tokenCode, policy, tokenMetadata, tokenSupply, config, totals, accessKeyList, storageBalance, account, protocol] = await Promise.all([
  provider.viewContractCode({ contractId: manifest.companyId, blockQuery: finalQuery }),
  provider.viewContractCode({ contractId: manifest.daoId, blockQuery: finalQuery }),
  provider.viewContractCode({ contractId: manifest.tokenId, blockQuery: finalQuery }),
  provider.callFunction({ contractId: manifest.daoId, method: "get_policy", args: {}, blockQuery: finalQuery }),
  provider.callFunction({ contractId: manifest.tokenId, method: "ft_metadata", args: {}, blockQuery: finalQuery }),
  provider.callFunction({ contractId: manifest.tokenId, method: "ft_total_supply", args: {}, blockQuery: finalQuery }),
  provider.callFunction({ contractId: manifest.companyId, method: "get_config", args: {}, blockQuery: finalQuery }),
  provider.callFunction({ contractId: manifest.companyId, method: "get_totals", args: {}, blockQuery: finalQuery }),
  provider.viewAccessKeyList({ accountId: manifest.companyId, finalityQuery: finalQuery }),
  provider.callFunction({ contractId: manifest.tokenId, method: "storage_balance_of", args: { account_id: manifest.companyId }, blockQuery: finalQuery }),
  provider.viewAccount({ accountId: manifest.companyId, blockQuery: finalQuery }),
  provider.experimental_protocolConfig({ finality: "final" }),
]);
const funding = assessCompanyFunding({ storageUsage: account.storage_usage, accountBalance: account.amount,
  codeBytesToAdd: 0, stateGrowthBytes: 0, storagePricePerByte: protocol.runtime_config.storage_amount_per_byte });
const issues = assessRelease({ manifest, artifacts, funding, requireFrozen: process.argv.includes("--require-frozen"), chain: {
  companyCodeHash: companyCode.hash, daoCodeHash: daoCode.hash, tokenCodeHash: tokenCode.hash,
  policy, tokenMetadata, tokenSupply, config, totals, storageBalance,
  accessKeys: accessKeyList.keys.map(key => ({ publicKey: key.public_key, permission: key.access_key.permission })),
} });
if (process.env.CAPTAB_COMPANY_CODE_HASH !== manifest.company.codeHash) issues.push("CAPTAB_COMPANY_CODE_HASH does not match the release manifest.");
if (process.env.NEXT_PUBLIC_COMPANY_CONTRACT_ID !== manifest.companyId) issues.push("NEXT_PUBLIC_COMPANY_CONTRACT_ID does not match the release manifest.");
console.log(JSON.stringify({ network: "testnet", companyId: manifest.companyId, verified: issues.length === 0,
  issues, companyFunding: funding, checkedAt: new Date().toISOString() }, null, 2));
if (issues.length) process.exitCode = 1;
