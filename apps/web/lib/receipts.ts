import type Database from "better-sqlite3";

export type ReceiptOutcome = {
  id: string;
  block_hash: string;
  outcome: { executor_id: string; logs: string[]; status: unknown };
};

export type FinalTransaction = {
  final_execution_status: string;
  status: unknown;
  transaction: { hash: string; signer_id: string };
  receipts_outcome: ReceiptOutcome[];
};

export type CaptabEvent = {
  receiptId: string;
  logIndex: number;
  eventName: string;
  version: string;
  payload: unknown;
};

export function parseCaptabEvents(receipts: ReceiptOutcome[], contractId: string): CaptabEvent[] {
  return receipts.flatMap(receipt => {
    if (receipt.outcome.executor_id !== contractId) return [];
    return receipt.outcome.logs.flatMap((line, logIndex) => {
      if (!line.startsWith("EVENT_JSON:")) return [];
      let event: unknown;
      try { event = JSON.parse(line.slice("EVENT_JSON:".length)); }
      catch { return []; }
      if (!event || typeof event !== "object") return [];
      const value = event as Record<string, unknown>;
      if (value.standard !== "captable" || value.version !== "1.0.0" || typeof value.event !== "string" || !Array.isArray(value.data)) return [];
      return [{ receiptId: receipt.id, logIndex, eventName: value.event, version: value.version, payload: value.data }];
    });
  });
}

function executionStatus(status: unknown): string {
  if (typeof status === "string") return status;
  if (status && typeof status === "object") {
    const keys = Object.keys(status);
    return keys[0] ?? "Unknown";
  }
  return "Unknown";
}

export function persistFinalTransaction(db: Database.Database, params: {
  operationId: string;
  companyId: string;
  contractId: string;
  txHash: string;
  signerId: string;
  result: FinalTransaction;
}) {
  const { operationId, companyId, contractId, txHash, signerId, result } = params;
  if (result.final_execution_status !== "FINAL") throw new Error("Transaction has not reached finality.");
  if (result.transaction.hash !== txHash || result.transaction.signer_id !== signerId) throw new Error("RPC transaction identity mismatch.");
  const events = parseCaptabEvents(result.receipts_outcome, contractId);
  const status = executionStatus(result.status) === "Failure" ? "Failed" : "Confirmed";
  db.transaction(() => {
    db.prepare("UPDATE operations SET status = ?, final_execution_status = ?, outcome_json = ?, observed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, result.final_execution_status, JSON.stringify(result), operationId);
    const insertReceipt = db.prepare(`INSERT INTO receipt_observations
      (network, receipt_id, operation_id, block_hash, executor_id, execution_status, raw_json)
      VALUES ('testnet', ?, ?, ?, ?, ?, ?) ON CONFLICT(network, receipt_id) DO NOTHING`);
    for (const receipt of result.receipts_outcome) {
      insertReceipt.run(receipt.id, operationId, receipt.block_hash, receipt.outcome.executor_id, executionStatus(receipt.outcome.status), JSON.stringify(receipt));
    }
    const insertEvent = db.prepare(`INSERT INTO chain_events
      (network, receipt_id, log_index, company_id, contract_id, event_version, event_name, payload_json)
      VALUES ('testnet', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(network, receipt_id, log_index) DO NOTHING`);
    for (const event of events) {
      insertEvent.run(event.receiptId, event.logIndex, companyId, contractId, event.version, event.eventName, JSON.stringify(event.payload));
    }
  })();
  return { status, receipts: result.receipts_outcome.length, events: events.length };
}
