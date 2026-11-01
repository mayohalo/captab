import Link from "next/link";
import { getDatabase } from "../../../../lib/db";
import { validAccountId } from "../../../../lib/near";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ActivityRow = { id: string; tx_hash: string; signer_id: string; status: string; created_at: string; observed_at: string | null };
type EventRow = { receipt_id: string; log_index: number; event_name: string; payload_json: string };

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validAccountId(id)) return <main><h1>Invalid company account</h1></main>;
  const db = getDatabase();
  const operations = db.prepare(`SELECT o.id, o.tx_hash, o.signer_id, o.status, o.created_at, o.observed_at
    FROM operations o JOIN companies c ON c.id = o.company_id
    WHERE c.network = 'testnet' AND c.contract_id = ? ORDER BY o.created_at DESC LIMIT 50`).all(id) as ActivityRow[];
  const events = db.prepare(`SELECT e.receipt_id, e.log_index, e.event_name, e.payload_json
    FROM chain_events e JOIN companies c ON c.id = e.company_id
    WHERE c.network = 'testnet' AND c.contract_id = ? ORDER BY e.rowid DESC LIMIT 100`).all(id) as EventRow[];
  return <main><Link href={`/company/${id}`}>← {id}</Link><h1>Activity</h1><p>NEAR testnet · tracked app submissions and their finalized receipts. Actions submitted outside this app may be absent from this history; current contract views remain authoritative.</p>
    <section><h2>Transactions</h2>{operations.length === 0 ? <p>No tracked transactions yet.</p> : <div className="cards">{operations.map(operation => <article key={operation.id}>
      <h3>{operation.status}</h3><p>{operation.signer_id} · {operation.created_at}</p><p>Observed {operation.observed_at ?? "pending"}</p>
      <a href={`https://testnet.nearblocks.io/txns/${operation.tx_hash}`} target="_blank" rel="noreferrer">View transaction</a> · <Link href={`/api/operations/${operation.id}`}>Receipt details</Link>
    </article>)}</div>}</section>
    <section><h2>Contract events</h2>{events.length === 0 ? <p>No tracked events yet.</p> : <div className="cards">{events.map(event => <article key={`${event.receipt_id}:${event.log_index}`}>
      <h3>{event.event_name}</h3><pre>{event.payload_json}</pre><p>Receipt {event.receipt_id}</p>
    </article>)}</div>}</section>
  </main>;
}
