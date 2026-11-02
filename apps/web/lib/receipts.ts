import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

export type ReceiptOutcome = {
  id: string;
  block_hash: string;
  outcome: { executor_id: string; logs: string[]; status: unknown };
};

export type FinalTransaction = {
  final_execution_status: string;
  status: unknown;
  transaction: { hash: string; signer_id: string; receiver_id?: string; actions?: { FunctionCall?: { method_name: string; args: string } }[] };
  receipts_outcome: ReceiptOutcome[];
};

export type CaptabEvent = {
  receiptId: string;
  logIndex: number;
  eventName: string;
  version: string;
  payload: unknown;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function proposalPayloadHash(proposal: { description: string; kind: unknown }): string {
  return createHash("sha256").update(canonical({ description: proposal.description, kind: proposal.kind })).digest("hex");
}

export function extractSubmittedProposal(result: FinalTransaction, daoId: string, companyContractId: string) {
  const transaction = result.transaction;
  if (transaction.receiver_id !== daoId || transaction.actions?.length !== 1) return null;
  const call = transaction.actions[0].FunctionCall;
  if (call?.method_name !== "add_proposal" || typeof call.args !== "string") return null;
  const status = result.status as { SuccessValue?: unknown } | null;
  if (typeof status?.SuccessValue !== "string") return null;
  try {
    const id = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8"));
    if (!Number.isSafeInteger(id) || id < 0) return null;
    const envelope = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
    const proposal = envelope?.proposal;
    const target = proposal?.kind?.FunctionCall;
    if (typeof proposal?.description !== "string" || !target || !Array.isArray(target.actions) || target.actions.length !== 1) return null;
    const action = target.actions[0];
    const args = JSON.parse(Buffer.from(action.args, "base64").toString("utf8"));
    if (target.receiver_id !== companyContractId && !(action.method_name === "ft_transfer_call" && args.receiver_id === companyContractId)) return null;
    const actionId = typeof args.action_id === "string" && args.action_id.length <= 80 ? args.action_id : null;
    return { proposalId: id, actionId, payloadHash: proposalPayloadHash(proposal) };
  } catch { return null; }
}

export function parseCaptabEvents(receipts: ReceiptOutcome[], contractId: string): CaptabEvent[] {
  return receipts.flatMap(receipt => {
    const status = executionStatus(receipt.outcome.status);
    if (receipt.outcome.executor_id !== contractId || (status !== "SuccessValue" && status !== "SuccessReceiptId")) return [];
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

export function classifyFinalTransaction(result: FinalTransaction, contractId: string): "Confirmed" | "Failed" | "NeedsReview" {
  const topLevel = executionStatus(result.status);
  if (topLevel === "Failure") return "Failed";
  if (topLevel !== "SuccessValue" && topLevel !== "SuccessReceiptId") return "NeedsReview";
  if (result.receipts_outcome.some(receipt => {
    if (receipt.outcome.executor_id !== contractId) return false;
    const status = executionStatus(receipt.outcome.status);
    return status !== "SuccessValue" && status !== "SuccessReceiptId";
  })) return "NeedsReview";
  return "Confirmed";
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
  const status = classifyFinalTransaction(result, contractId);
  const company = db.prepare("SELECT dao_id FROM companies WHERE id = ?").get(companyId) as { dao_id: string } | undefined;
  if (!company) throw new Error("Tracked company was not found.");
  const relevant = [contractId, company.dao_id].includes(result.transaction.receiver_id ?? "") ||
    result.receipts_outcome.some(receipt => [contractId, company.dao_id].includes(receipt.outcome.executor_id));
  if (!relevant) throw new Error("Transaction has no company or DAO execution evidence.");
  const daoId = company.dao_id;
  const proposal = extractSubmittedProposal(result, daoId, contractId);
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
    if (proposal) {
      db.prepare(`INSERT INTO proposals (network, dao_id, proposal_id, company_id, submission_tx_hash, action_id, payload_hash, observed_status, last_checked_at)
        VALUES ('testnet', ?, ?, ?, ?, ?, ?, 'Submitted', CURRENT_TIMESTAMP)
        ON CONFLICT(network, dao_id, proposal_id) DO NOTHING`)
        .run(daoId, proposal.proposalId, companyId, txHash, proposal.actionId, proposal.payloadHash);
    }
  })();
  return { status, receipts: result.receipts_outcome.length, events: events.length };
}
