import { NextResponse } from "next/server";
import { getDatabase } from "../../../../lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid operation ID" }, { status: 400 });
  const db = getDatabase();
  const operation = db.prepare(`SELECT o.id, o.network, o.tx_hash, o.signer_id, o.status,
      o.final_execution_status, o.check_count, o.last_error, o.created_at, o.observed_at, c.contract_id
    FROM operations o JOIN companies c ON c.id = o.company_id WHERE o.id = ?`).get(id);
  if (!operation) return NextResponse.json({ error: "Operation not found" }, { status: 404 });
  const receipts = db.prepare("SELECT receipt_id, block_hash, executor_id, execution_status FROM receipt_observations WHERE operation_id = ? ORDER BY receipt_id").all(id);
  const events = db.prepare(`SELECT e.receipt_id, e.log_index, e.event_name, e.event_version, e.payload_json
    FROM chain_events e JOIN receipt_observations r ON r.network = e.network AND r.receipt_id = e.receipt_id
    WHERE r.operation_id = ? ORDER BY e.receipt_id, e.log_index`).all(id);
  return NextResponse.json({ operation, receipts, events });
}
