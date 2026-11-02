import Link from "next/link";
import { getDatabase } from "../../../../lib/db";
import { validAccountId } from "../../../../lib/near";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ActivityRow = { id: string; tx_hash: string; signer_id: string; status: string; created_at: string; observed_at: string | null };
type EventRow = { receipt_id: string; log_index: number; event_name: string; payload_json: string };
type ProposalRow = { dao_id: string; proposal_id: number; action_id: string | null; submission_tx_hash: string | null; observed_status: string; last_checked_at: string | null };

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
  const proposals = db.prepare(`SELECT p.dao_id, p.proposal_id, p.action_id, p.submission_tx_hash, p.observed_status, p.last_checked_at
    FROM proposals p JOIN companies c ON c.id = p.company_id
    WHERE c.network = 'testnet' AND c.contract_id = ? ORDER BY p.proposal_id DESC LIMIT 50`).all(id) as ProposalRow[];
  const pending = operations.filter(operation => operation.status === "Pending").length;
  const needsReview = operations.filter(operation => operation.status === "NeedsReview").length;
  const lastObservedAt = operations.map(operation => operation.observed_at).filter((value): value is string => Boolean(value)).sort().at(-1);
  const audit = db.prepare(`SELECT a.state, a.checked_at, a.issues_json FROM company_audits a
    JOIN companies c ON c.id = a.company_id WHERE c.network = 'testnet' AND c.contract_id = ?`).get(id) as {
      state: string; checked_at: string; issues_json: string;
    } | undefined;
  return <main><Link href={`/company/${id}`}>← {id}</Link><h1>Activity</h1><p>NEAR testnet · tracked app submissions and their finalized receipts. Actions submitted outside this app may be absent from this history; current contract views remain authoritative.</p>
    <p>Tracked history: {pending} pending · {needsReview} need review · last final observation {lastObservedAt ?? "none"}. <Link href={`/api/companies/${id}`}>Check authoritative ledger and history coverage</Link>.</p>
    <p>Last periodic chain audit: {audit ? `${audit.state} at ${audit.checked_at}` : "not yet run"}.</p>
    {audit && audit.state !== "Consistent" && <p role="alert">{(JSON.parse(audit.issues_json) as string[]).join(" ")}</p>}
    <section><h2>Transactions</h2>{operations.length === 0 ? <p>No tracked transactions yet.</p> : <div className="cards">{operations.map(operation => <article key={operation.id}>
      <h3>{operation.status}</h3><p>{operation.signer_id} · {operation.created_at}</p><p>Observed {operation.observed_at ?? "pending"}</p>
      <a href={`https://testnet.nearblocks.io/txns/${operation.tx_hash}`} target="_blank" rel="noreferrer">View transaction</a> · <Link href={`/api/operations/${operation.id}`}>Receipt details</Link>
    </article>)}</div>}</section>
    <section><h2>Tracked DAO proposals</h2>{proposals.length === 0 ? <p>No finalized proposal submissions tracked yet.</p> : <div className="cards">{proposals.map(proposal => <article key={`${proposal.dao_id}:${proposal.proposal_id}`}>
      <h3>#{proposal.proposal_id} · {proposal.observed_status}</h3><p>DAO {proposal.dao_id} · action {proposal.action_id ?? "token funding"}</p>
      <p>Governance status checked {proposal.last_checked_at ?? "not yet"}. Confirm company execution in finalized receipts and contract views.</p>
      {proposal.submission_tx_hash && <a href={`https://testnet.nearblocks.io/txns/${proposal.submission_tx_hash}`} target="_blank" rel="noreferrer">Submission transaction</a>}
    </article>)}</div>}</section>
    <section><h2>Contract events</h2>{events.length === 0 ? <p>No tracked events yet.</p> : <div className="cards">{events.map(event => <article key={`${event.receipt_id}:${event.log_index}`}>
      <h3>{event.event_name}</h3><pre>{event.payload_json}</pre><p>Receipt {event.receipt_id}</p>
    </article>)}</div>}</section>
  </main>;
}
