import { loadDeploymentEnv, manifestPath } from "./deployment-paths.mjs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, KeyPair } from "near-api-js";
import { assessCompanyFreeze, publicAccessKeys, removeCompanyDeploymentKey } from "../lib/company-freeze.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDeploymentEnv();
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const apply = process.argv.includes("--apply");
const verificationScript = resolve(root, "apps/web/scripts/verify-testnet-release.mjs");

function verifyRelease(requireFrozen = false) {
  const result = spawnSync(process.execPath, [verificationScript, ...(requireFrozen ? ["--require-frozen"] : [])], {
    cwd: root, env: process.env, stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Read-only release verification failed; key removal was not attempted");
}

if (manifest.company?.frozen === true) {
  verifyRelease(true);
  console.log("Company is already frozen and the final release check passed.");
  process.exit(0);
}
verifyRelease();
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com" });
if (await provider.getNetworkId() !== "testnet") throw new Error("RPC endpoint is not NEAR testnet");
const companyId = manifest.companyId;
const finalQuery = { finality: "final" };
const [code, keyList] = await Promise.all([
  provider.viewContractCode({ contractId: companyId, blockQuery: finalQuery }),
  provider.viewAccessKeyList({ accountId: companyId, finalityQuery: finalQuery }),
]);
const accessKeys = publicAccessKeys(keyList);
const privateKey = process.env.CAPTAB_COMPANY_PRIVATE_KEY;
const signingPublicKey = privateKey ? KeyPair.fromString(privateKey).getPublicKey().toString() : manifest.company?.deploymentPublicKey;
const issues = assessCompanyFreeze({ manifest, codeHash: code.hash, accessKeys, deploymentPublicKey: signingPublicKey });
console.log(JSON.stringify({ network: "testnet", companyId, deploymentPublicKey: signingPublicKey,
  action: "remove the company's last full-access deployment key", remainingAccessKeys: accessKeys, issues }, null, 2));
if (issues.length) process.exit(1);
if (!apply) {
  console.log("Preflight only. Run with --apply only after reviewing the live rehearsal and release verification.");
  process.exit(0);
}
if (!privateKey) throw new Error("Set CAPTAB_COMPANY_PRIVATE_KEY locally before --apply");

const { txHash, remainingAccessKeys } = await removeCompanyDeploymentKey({ provider, companyId, privateKey,
  publicKey: signingPublicKey, expectedCodeHash: manifest.company.codeHash });
const updated = { ...manifest, company: { ...manifest.company, frozen: true, remainingAccessKeys },
  transactions: { ...manifest.transactions, keyRemoval: txHash }, verifiedAt: new Date().toISOString() };
const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`);
await rename(temporaryPath, manifestPath);
verifyRelease(true);
console.log(`Company deployment key removed and frozen release manifest verified: ${manifestPath}`);
