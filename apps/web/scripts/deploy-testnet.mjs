import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, actions, baseEncode, teraToGas } from "near-api-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
try { process.loadEnvFile(resolve(root, "apps/web/.env.local")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
const companyWasmPath = resolve(root, "target/wasm32-unknown-unknown/release/captab_company.wasm");
const daoWasmPath = resolve(root, ".cache/sputnik/target/wasm32-unknown-unknown/release/sputnikdao2.wasm");
const tokenWasmPath = resolve(root, "target/wasm32-unknown-unknown/release/captab_test_token.wasm");
const manifestPath = resolve(root, "docs/deployment-manifest.testnet.json");
try {
  const previous = JSON.parse(await readFile(manifestPath, "utf8"));
  if (previous.companyId !== process.env.CAPTAB_COMPANY_ACCOUNT_ID) throw new Error("Existing manifest belongs to another company account");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const pinnedDaoSha256 = "a6055ab340bb5b9909ce4ff4bc7d2ae365b77d7b4b74d481fc2d2ee97c8a0722";
const apply = process.argv.includes("--apply");
const rpcUrl = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
const companyId = process.env.CAPTAB_COMPANY_ACCOUNT_ID;
const daoId = process.env.CAPTAB_DAO_ACCOUNT_ID;
const operatorId = process.env.CAPTAB_OPERATOR_ACCOUNT_ID;
const tokenId = process.env.CAPTAB_TOKEN_ACCOUNT_ID;
const units = process.env.CAPTAB_AUTHORIZED_UNITS;
const companyKey = process.env.CAPTAB_COMPANY_PRIVATE_KEY;
const validAccount = id => typeof id === "string" && /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id);
if (![companyId, daoId, operatorId, tokenId].every(validAccount) || !/^[1-9][0-9]*$/.test(units ?? "")) {
  throw new Error("Set CAPTAB_COMPANY_ACCOUNT_ID, CAPTAB_DAO_ACCOUNT_ID, CAPTAB_OPERATOR_ACCOUNT_ID, CAPTAB_TOKEN_ACCOUNT_ID, and positive CAPTAB_AUTHORIZED_UNITS");
}
if (BigInt(units) > 1_000_000_000_000_000n) throw new Error("Authorized units exceed the contract limit");
if (apply && !companyKey) throw new Error("Set CAPTAB_COMPANY_PRIVATE_KEY locally before --apply");

const sha256 = bytes => createHash("sha256").update(bytes).digest();
const [companyWasm, daoWasm, tokenWasm] = await Promise.all([readFile(companyWasmPath), readFile(daoWasmPath), readFile(tokenWasmPath)]);
const companyDigest = sha256(companyWasm);
const daoDigest = sha256(daoWasm);
const companyCodeHash = baseEncode(companyDigest);
const daoCodeHash = baseEncode(daoDigest);
const tokenDigest = sha256(tokenWasm);
const tokenCodeHash = baseEncode(tokenDigest);
if (daoDigest.toString("hex") !== pinnedDaoSha256) throw new Error("Local Sputnik WASM differs from pinned source");

const provider = new JsonRpcProvider({ url: rpcUrl });
if (await provider.getNetworkId() !== "testnet") throw new Error("RPC endpoint is not NEAR testnet");
const [daoCode, tokenCode, policy, tokenMetadata, companyAccount, initialStorage] = await Promise.all([
  provider.viewContractCode({ contractId: daoId }),
  provider.viewContractCode({ contractId: tokenId }),
  provider.callFunction({ contractId: daoId, method: "get_policy", args: {} }),
  provider.callFunction({ contractId: tokenId, method: "ft_metadata", args: {} }),
  provider.viewAccount({ accountId: companyId }),
  provider.callFunction({ contractId: tokenId, method: "storage_balance_of", args: { account_id: companyId } }).catch(() => undefined),
]);
if (daoCode.hash !== daoCodeHash) throw new Error("Deployed DAO code hash does not match pinned Sputnik build");
if (tokenCode.hash !== tokenCodeHash) throw new Error("Deployed token code hash does not match local TESTUSD fixture");
const council = policy?.roles?.find(role => role.name === "council");
const members = council?.kind?.Group;
const vote = policy?.default_vote_policy;
if (!Array.isArray(members) || members.length !== 3 || new Set(members).size !== 3 ||
    !Array.isArray(council.permissions) || !council.permissions.includes("*:VoteApprove") ||
    Object.keys(council.vote_policy ?? {}).length !== 0 || vote?.weight_kind !== "RoleWeight" || String(vote?.quorum) !== "0" ||
    JSON.stringify(vote?.threshold?.Ratio) !== JSON.stringify([1, 2])) {
  throw new Error("DAO policy is not the pinned three-member two-vote council policy");
}
if (!tokenMetadata || tokenMetadata.spec !== "ft-1.0.0" || tokenMetadata.symbol !== "TESTUSD" || tokenMetadata.decimals !== 6) {
  throw new Error("Settlement token lacks valid NEP-141 metadata");
}
const emptyHash = baseEncode(new Uint8Array(32));
if (companyAccount.code_hash !== emptyHash && companyAccount.code_hash !== companyCodeHash) {
  throw new Error("Company account already contains different code; use a fresh account");
}

const expectedConfig = { dao_id: daoId, snapshot_operator_id: operatorId, settlement_token_id: tokenId, authorized_units: units };
let config = null;
if (companyAccount.code_hash === companyCodeHash) {
  try { config = await provider.callFunction({ contractId: companyId, method: "get_config", args: {} }); }
  catch { /* Code may be deployed but not initialized. */ }
}
if (config && Object.entries(expectedConfig).some(([key, value]) => String(config[key]) !== value)) {
  throw new Error("Existing company initialization differs from requested configuration");
}
console.log(JSON.stringify({ network: "testnet", companyId, daoId, council: members, operatorId, tokenId,
  token: { symbol: tokenMetadata.symbol, decimals: tokenMetadata.decimals, wasmSha256: tokenDigest.toString("hex"), companyStorage: initialStorage ? "registered" : "missing or unavailable" },
  companyWasmSha256: companyDigest.toString("hex"), daoWasmSha256: daoDigest.toString("hex"),
  action: config ? "verify existing deployment" : companyAccount.code_hash === emptyHash ? "deploy and initialize" : "initialize existing code" }, null, 2));
if (!apply) {
  console.log("Preflight only. Pass --apply with the company account key to deploy or initialize.");
  process.exit(0);
}

const signerKey = KeyPair.fromString(companyKey);
const accessKey = await provider.viewAccessKey({ accountId: companyId, publicKey: signerKey.getPublicKey().toString() });
if (accessKey.permission !== "FullAccess") throw new Error("Company deployment key must have full access");
const company = new Account(companyId, provider, companyKey);
const transactions = {};
if (companyAccount.code_hash === emptyHash) {
  const result = await company.signAndSendTransaction({ receiverId: companyId, actions: [actions.deployContract(companyWasm)], waitUntil: "FINAL" });
  transactions.deploy = result.transaction.hash;
}
if (!config) {
  const result = await company.callFunctionRaw({ contractId: companyId, methodName: "new", args: expectedConfig,
    gas: teraToGas(40), deposit: 0n, waitUntil: "FINAL" });
  transactions.initialize = result.transaction.hash;
}
const [verifiedCode, verifiedConfig, totals, accessKeys] = await Promise.all([
  provider.viewContractCode({ contractId: companyId }),
  provider.callFunction({ contractId: companyId, method: "get_config", args: {} }),
  provider.callFunction({ contractId: companyId, method: "get_totals", args: {} }),
  provider.viewAccessKeyList({ accountId: companyId }),
]);
if (verifiedCode.hash !== companyCodeHash || Object.entries(expectedConfig).some(([key, value]) => String(verifiedConfig[key]) !== value) || totals.issued_total !== "0") {
  throw new Error("Deployment verification failed; inspect transaction receipts before retrying");
}
let storageRegistration = "unverified";
let storageBalance = null;
try {
  storageBalance = await provider.callFunction({ contractId: tokenId, method: "storage_balance_of", args: { account_id: companyId } });
  storageRegistration = storageBalance ? "registered" : "missing";
} catch { /* Some test tokens do not expose storage management. */ }
if (storageRegistration === "missing") {
  const bounds = await provider.callFunction({ contractId: tokenId, method: "storage_balance_bounds", args: {} });
  if (!bounds?.min || !/^[1-9][0-9]*$/.test(String(bounds.min))) throw new Error("Token storage registration minimum is unavailable");
  const registration = await company.callFunctionRaw({ contractId: tokenId, methodName: "storage_deposit",
    args: { account_id: companyId, registration_only: true }, gas: teraToGas(30), deposit: BigInt(bounds.min), waitUntil: "FINAL" });
  transactions.storageRegistration = registration.transaction.hash;
  storageBalance = await provider.callFunction({ contractId: tokenId, method: "storage_balance_of", args: { account_id: companyId } });
  if (!storageBalance) throw new Error("Token registration did not persist");
  storageRegistration = "registered";
}
const manifest = {
  network: "testnet", companyId, daoId, operatorId, tokenId,
  dao: { sourceCommit: "5434a59dec23ee0c49df8c8c4350c208a7e75b0b", sha256: pinnedDaoSha256, codeHash: daoCodeHash,
    council: members, defaultVotePolicy: vote },
  company: { sha256: companyDigest.toString("hex"), codeHash: companyCodeHash, authorizedUnits: units,
    remainingAccessKeys: accessKeys.keys.map(key => ({ publicKey: key.public_key, permission: key.access_key.permission })) },
  token: { symbol: tokenMetadata.symbol, decimals: tokenMetadata.decimals, sha256: tokenDigest.toString("hex"), codeHash: tokenCodeHash, storageRegistration, storageBalance },
  transactions, verifiedAt: new Date().toISOString(),
};
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w" });
console.log(`Verified deployment manifest: ${manifestPath}`);
if (storageRegistration !== "registered") console.warn("Register the company with the settlement token before DAO funding.");
