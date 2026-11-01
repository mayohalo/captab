import { NextResponse } from "next/server";
import { getDatabase } from "../../../../lib/db";
import { type OperationRow, reconcileOperation } from "../../../../lib/observer";

export const runtime = "nodejs";

type PendingRow = OperationRow & { contract_id: string };

export async function POST(request: Request) {
  const secret = process.env.CAPTAB_WORKER_SECRET;
  if (!secret) return NextResponse.json({ error: "Worker secret is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDatabase();
  const pending = db.prepare(`SELECT o.id, o.company_id, o.network, o.tx_hash, o.signer_id,
      o.status, o.check_count, o.last_error, c.contract_id
    FROM operations o JOIN companies c ON c.id = o.company_id
    WHERE o.status = 'Pending' AND (o.last_checked_at IS NULL OR o.last_checked_at <= datetime('now', '-30 seconds'))
    ORDER BY o.created_at LIMIT 20`).all() as PendingRow[];
  const results = [];
  for (const operation of pending) {
    const updated = await reconcileOperation(operation, operation.contract_id);
    results.push({ operationId: updated.id, status: updated.status });
  }
  return NextResponse.json({ checked: results.length, results });
}
