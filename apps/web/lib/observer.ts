import { randomUUID } from "node:crypto";
import { JsonRpcProvider } from "near-api-js";
import { ensureCompany, getDatabase } from "./db";
import { assertTestnetNetwork, type CompanyConfig, view } from "./near";
import { type FinalTransaction, persistFinalTransaction } from "./receipts";
import { assertObservedTransaction } from "./transaction-identity.mjs";

const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com" });

export type OperationRow = {
  id: string;
  company_id: string;
  network: string;
  tx_hash: string;
  signer_id: string;
  status: string;
  check_count: number;
  last_error: string | null;
};

export async function registerOperation(contractId: string, txHash: string, signerId: string): Promise<OperationRow> {
  const config = await view<CompanyConfig>(contractId, "get_config");
  const included = await provider.viewTransactionStatus({ txHash, accountId: signerId, waitUntil: "INCLUDED" });
  assertObservedTransaction(included, { txHash, signerId, companyId: contractId, daoId: config.dao_id });
  const db = getDatabase();
  const companyId = ensureCompany(db, contractId, config.dao_id);
  db.prepare(`INSERT INTO operations (id, company_id, network, tx_hash, signer_id, status)
    VALUES (?, ?, 'testnet', ?, ?, 'Pending') ON CONFLICT(network, tx_hash) DO NOTHING`)
    .run(randomUUID(), companyId, txHash, signerId);
  const row = db.prepare("SELECT id, company_id, network, tx_hash, signer_id, status, check_count, last_error FROM operations WHERE network = 'testnet' AND tx_hash = ?")
    .get(txHash) as OperationRow;
  if (row.company_id !== companyId || row.signer_id !== signerId) throw new Error("Transaction already registered with a different company or signer.");
  return row;
}

export async function reconcileOperation(operation: OperationRow, contractId: string) {
  if (operation.status !== "Pending") return operation;
  const db = getDatabase();
  db.prepare("UPDATE operations SET check_count = check_count + 1, last_checked_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(operation.id);
  try {
    await assertTestnetNetwork();
    const result = await provider.viewTransactionStatusWithReceipts({
      txHash: operation.tx_hash,
      accountId: operation.signer_id,
      waitUntil: "FINAL",
    }) as unknown as FinalTransaction;
    if (result.final_execution_status !== "FINAL") return operation;
    persistFinalTransaction(db, {
      operationId: operation.id,
      companyId: operation.company_id,
      contractId,
      txHash: operation.tx_hash,
      signerId: operation.signer_id,
      result,
    });
  } catch (error) {
    db.prepare("UPDATE operations SET last_error = ? WHERE id = ?")
      .run((error instanceof Error ? error.message : "RPC read failed").slice(0, 300), operation.id);
  }
  return db.prepare("SELECT id, company_id, network, tx_hash, signer_id, status, check_count, last_error FROM operations WHERE id = ?")
    .get(operation.id) as OperationRow;
}
