import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, actions, baseEncode, teraToGas } from "near-api-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
try { process.loadEnvFile(resolve(root, "apps/web/.env.local")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
const wasm = await readFile(resolve(root, ".cache/sputnik/target/wasm32-unknown-unknown/release/sputnikdao2.wasm"));
const digest = createHash("sha256").update(wasm).digest();
const expected = "a6055ab340bb5b9909ce4ff4bc7d2ae365b77d7b4b74d481fc2d2ee97c8a0722";
if (digest.toString("hex") !== expected) throw new Error("Pinned Sputnik DAO WASM hash mismatch");
const codeHash = baseEncode(digest);
const daoId = process.env.CAPTAB_DAO_ACCOUNT_ID;
const members = (process.env.CAPTAB_COUNCIL_ACCOUNTS ?? "").split(",").map(value => value.trim());
const accountPattern = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
if (!daoId || !accountPattern.test(daoId) || members.length !== 3 || new Set(members).size !== 3 || !members.every(id => accountPattern.test(id))) {
  throw new Error("Set CAPTAB_DAO_ACCOUNT_ID and three distinct CAPTAB_COUNCIL_ACCOUNTS");
}
const apply = process.argv.includes("--apply");
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org" });
const finalQuery = { finality: "final" };
if (await provider.getNetworkId() !== "testnet") throw new Error("RPC endpoint is not NEAR testnet");
const daoState = await provider.viewAccount({ accountId: daoId, blockQuery: finalQuery });
const emptyHash = baseEncode(new Uint8Array(32));
if (daoState.code_hash !== emptyHash && daoState.code_hash !== codeHash) throw new Error("DAO account contains different code; use a fresh account");
let policy = null;
if (daoState.code_hash === codeHash) {
  try { policy = await provider.callFunction({ contractId: daoId, method: "get_policy", args: {}, blockQuery: finalQuery }); }
  catch { /* Pinned code exists but initialization remains pending. */ }
}
if (policy) {
  const role = policy.roles?.find(role => role.name === "council");
  const actual = role?.kind?.Group;
  if (!Array.isArray(actual) || actual.length !== 3 || actual.some(id => !members.includes(id)) ||
      !role.permissions?.includes("*:VoteApprove") || policy.default_vote_policy?.weight_kind !== "RoleWeight" ||
      String(policy.default_vote_policy?.quorum) !== "0" ||
      JSON.stringify(policy.default_vote_policy?.threshold?.Ratio) !== JSON.stringify([1, 2]) ||
      Object.keys(role.vote_policy ?? {}).length !== 0) throw new Error("Existing DAO policy differs from requested two-vote council");
}
console.log(JSON.stringify({ network: "testnet", daoId, members, sourceCommit: "5434a59dec23ee0c49df8c8c4350c208a7e75b0b",
  wasmSha256: expected, action: policy ? "verify existing DAO" : daoState.code_hash === emptyHash ? "deploy and initialize DAO" : "initialize pinned DAO code" }, null, 2));
if (!apply) { console.log("Preflight only. Pass --apply with the DAO account key to deploy or initialize."); process.exit(0); }
const privateKey = process.env.CAPTAB_DAO_PRIVATE_KEY;
if (!privateKey) throw new Error("Set CAPTAB_DAO_PRIVATE_KEY locally before --apply");
const key = KeyPair.fromString(privateKey);
const access = await provider.viewAccessKey({ accountId: daoId, publicKey: key.getPublicKey().toString(), finalityQuery: finalQuery });
if (access.permission !== "FullAccess") throw new Error("DAO deployment key must have full access");
const dao = new Account(daoId, provider, privateKey);
if (daoState.code_hash === emptyHash) {
  const result = await dao.signAndSendTransaction({ receiverId: daoId, actions: [actions.deployContract(wasm)], waitUntil: "FINAL" });
  console.log("Sputnik deploy transaction:", result.transaction.hash);
}
if (!policy) {
  const result = await dao.callFunctionRaw({ contractId: daoId, methodName: "new", args: {
    config: { name: process.env.CAPTAB_DAO_NAME ?? "CapTable Demo DAO", purpose: "Govern a testnet company ownership ledger", metadata: "" },
    policy: members,
  }, gas: teraToGas(70), deposit: 0n, waitUntil: "FINAL" });
  console.log("Sputnik initialization transaction:", result.transaction.hash);
}
const [verifiedCode, verifiedPolicy] = await Promise.all([
  provider.viewContractCode({ contractId: daoId, blockQuery: finalQuery }),
  provider.callFunction({ contractId: daoId, method: "get_policy", args: {}, blockQuery: finalQuery }),
]);
const role = verifiedPolicy?.roles?.find(role => role.name === "council");
const actual = role?.kind?.Group;
if (verifiedCode.hash !== codeHash || !Array.isArray(actual) || actual.length !== 3 || actual.some(id => !members.includes(id)) ||
    !role.permissions?.includes("*:VoteApprove") || verifiedPolicy.default_vote_policy?.weight_kind !== "RoleWeight" ||
    String(verifiedPolicy.default_vote_policy?.quorum) !== "0" ||
    JSON.stringify(verifiedPolicy.default_vote_policy?.threshold?.Ratio) !== JSON.stringify([1, 2]) ||
    Object.keys(role.vote_policy ?? {}).length !== 0) {
  throw new Error("DAO deployment verification failed; inspect receipts before retrying");
}
console.log("Pinned three-member Sputnik DAO verified on testnet:", daoId);
