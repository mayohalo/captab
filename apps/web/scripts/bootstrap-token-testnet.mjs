import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, actions, baseEncode, teraToGas } from "near-api-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
try { process.loadEnvFile(resolve(root, "apps/web/.env.local")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
const wasm = await readFile(resolve(root, "target/wasm32-unknown-unknown/release/captab_test_token.wasm"));
const digest = createHash("sha256").update(wasm).digest();
const codeHash = baseEncode(digest);
const tokenId = process.env.CAPTAB_TOKEN_ACCOUNT_ID;
const daoId = process.env.CAPTAB_DAO_ACCOUNT_ID;
const supply = process.env.CAPTAB_TOKEN_SUPPLY ?? "100000000000";
const accountPattern = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
if (![tokenId, daoId].every(id => typeof id === "string" && accountPattern.test(id)) || !/^[1-9][0-9]*$/.test(supply)) {
  throw new Error("Set CAPTAB_TOKEN_ACCOUNT_ID, CAPTAB_DAO_ACCOUNT_ID, and positive CAPTAB_TOKEN_SUPPLY (base units)");
}
const apply = process.argv.includes("--apply");
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org" });
const finalQuery = { finality: "final" };
if (await provider.getNetworkId() !== "testnet") throw new Error("RPC endpoint is not NEAR testnet");
const state = await provider.viewAccount({ accountId: tokenId, blockQuery: finalQuery });
const emptyHash = baseEncode(new Uint8Array(32));
if (state.code_hash !== emptyHash && state.code_hash !== codeHash) throw new Error("Token account contains different code; use a fresh account");
let metadata = null;
if (state.code_hash === codeHash) {
  try { metadata = await provider.callFunction({ contractId: tokenId, method: "ft_metadata", args: {}, blockQuery: finalQuery }); }
  catch { /* Pinned token code exists but initialization remains pending. */ }
}
if (metadata && (metadata.spec !== "ft-1.0.0" || metadata.symbol !== "TESTUSD" || metadata.decimals !== 6)) throw new Error("Existing token metadata differs from TESTUSD fixture");
if (metadata) {
  const currentSupply = await provider.callFunction({ contractId: tokenId, method: "ft_total_supply", args: {}, blockQuery: finalQuery });
  if (String(currentSupply) !== supply) throw new Error("Existing token supply differs from configured TESTUSD supply");
}
console.log(JSON.stringify({ network: "testnet", tokenId, daoId, totalSupplyBaseUnits: supply,
  wasmSha256: digest.toString("hex"), action: metadata ? "verify existing token" : state.code_hash === emptyHash ? "deploy and initialize token" : "initialize pinned token code" }, null, 2));
if (!apply) { console.log("Preflight only. Pass --apply with the token account key to deploy or initialize."); process.exit(0); }
const privateKey = process.env.CAPTAB_TOKEN_PRIVATE_KEY;
if (!privateKey) throw new Error("Set CAPTAB_TOKEN_PRIVATE_KEY locally before --apply");
const key = KeyPair.fromString(privateKey);
const access = await provider.viewAccessKey({ accountId: tokenId, publicKey: key.getPublicKey().toString(), finalityQuery: finalQuery });
if (access.permission !== "FullAccess") throw new Error("Token deployment key must have full access");
const token = new Account(tokenId, provider, privateKey);
if (state.code_hash === emptyHash) {
  const result = await token.signAndSendTransaction({ receiverId: tokenId, actions: [actions.deployContract(wasm)], waitUntil: "FINAL" });
  console.log("Token deploy transaction:", result.transaction.hash);
}
if (!metadata) {
  const result = await token.callFunctionRaw({ contractId: tokenId, methodName: "new", args: { owner_id: daoId, total_supply: supply },
    gas: teraToGas(40), deposit: 0n, waitUntil: "FINAL" });
  console.log("Token initialization transaction:", result.transaction.hash);
}
const [verifiedCode, verifiedMetadata, totalSupply, daoBalance] = await Promise.all([
  provider.viewContractCode({ contractId: tokenId, blockQuery: finalQuery }),
  provider.callFunction({ contractId: tokenId, method: "ft_metadata", args: {}, blockQuery: finalQuery }),
  provider.callFunction({ contractId: tokenId, method: "ft_total_supply", args: {}, blockQuery: finalQuery }),
  provider.callFunction({ contractId: tokenId, method: "ft_balance_of", args: { account_id: daoId }, blockQuery: finalQuery }),
]);
if (verifiedCode.hash !== codeHash || verifiedMetadata.spec !== "ft-1.0.0" || verifiedMetadata.symbol !== "TESTUSD" || verifiedMetadata.decimals !== 6 ||
    String(totalSupply) !== supply || (!metadata && String(daoBalance) !== supply)) {
  throw new Error("Token deployment verification failed; inspect receipts before retrying");
}
console.log("TESTUSD fixture and DAO treasury balance verified:", tokenId);
