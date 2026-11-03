import { randomUUID } from "node:crypto";
import { Account, JsonRpcProvider } from "near-api-js";
import { ensureCompany, getDatabase } from "./db";
import { type CompanyConfig, type Grant, validAccountId, verifiedCompanyCode, view } from "./near";
import { inspectSponsoredClaim } from "./sponsor-policy";
import { reserveSponsorRequest } from "./sponsor-rate";

const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org" });

export async function relaySponsoredClaim(companyContractId: string, encoded: string) {
  if (!validAccountId(companyContractId)) throw new Error("Invalid company account");
  await verifiedCompanyCode(companyContractId);
  const block = await provider.viewBlock({ finality: "final" });
  const claim = inspectSponsoredClaim(encoded, companyContractId, BigInt(block.header.height));
  const [config, grant, accessKey] = await Promise.all([
    view<CompanyConfig>(companyContractId, "get_config"),
    view<Grant | null>(companyContractId, "get_grant", { grant_id: claim.grantId }),
    provider.viewAccessKey({ accountId: claim.senderId, publicKey: claim.publicKey,
      finalityQuery: { finality: "final" } }),
  ]);
  if (config.paused || !grant || grant.recipient !== claim.senderId || BigInt(grant.claimable_units) <= 0n) throw new Error("Grant is not claimable by signer");
  if (accessKey.permission !== "FullAccess") throw new Error("Delegate signer must have a full-access key");
  if (claim.nonce <= accessKey.nonce || claim.nonce >= BigInt(block.header.height) * 1_000_000n) throw new Error("Delegate nonce is invalid");
  const accountId = process.env.CAPTAB_RELAYER_ACCOUNT_ID;
  const privateKey = process.env.CAPTAB_RELAYER_PRIVATE_KEY;
  if (!accountId || !validAccountId(accountId) || !privateKey) throw new Error("Relayer credentials are not configured");
  const db = getDatabase();
  const companyId = ensureCompany(db, companyContractId, config.dao_id);
  reserveSponsorRequest(db, { digest: claim.digest, companyId, accountId: claim.senderId, grantId: claim.grantId, gas: claim.gas });
  try {
    const relayer = new Account(accountId, provider, privateKey as `ed25519:${string}`);
    const result = await relayer.relayMetaTransaction(claim.signed);
    const txHash = result.transaction.hash;
    db.transaction(() => {
      db.prepare("UPDATE sponsor_requests SET outcome = 'Submitted', tx_hash = ? WHERE delegate_digest = ?").run(txHash, claim.digest);
      db.prepare(`INSERT INTO operations (id, company_id, network, tx_hash, signer_id, status)
        VALUES (?, ?, 'testnet', ?, ?, 'Pending') ON CONFLICT(network, tx_hash) DO NOTHING`).run(randomUUID(), companyId, txHash, accountId);
    })();
    return { txHash, accountId: claim.senderId, grantId: claim.grantId };
  } catch (error) {
    db.prepare("UPDATE sponsor_requests SET outcome = 'NeedsReview', last_error = ? WHERE delegate_digest = ?")
      .run((error instanceof Error ? error.message : "Relayer outcome unknown").slice(0, 300), claim.digest);
    throw new Error("Relay outcome is uncertain; keep the signed request for review");
  }
}

export function reconcileSponsorRequests() {
  const db = getDatabase();
  const result = db.prepare(`UPDATE sponsor_requests SET outcome = (
    SELECT CASE o.status WHEN 'Confirmed' THEN 'Confirmed' WHEN 'Failed' THEN 'Failed' ELSE 'NeedsReview' END
    FROM operations o WHERE o.network = 'testnet' AND o.tx_hash = sponsor_requests.tx_hash
  ) WHERE outcome = 'Submitted' AND EXISTS (
    SELECT 1 FROM operations o WHERE o.network = 'testnet' AND o.tx_hash = sponsor_requests.tx_hash
      AND o.status IN ('Confirmed', 'Failed', 'NeedsReview')
  )`).run();
  return result.changes;
}
