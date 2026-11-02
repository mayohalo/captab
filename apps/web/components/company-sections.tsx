import Link from "next/link";
import { formatUnits, percent, type Distribution, type Grant, type Holding, type Totals } from "../lib/near";
import { WalletControl } from "./wallet";

export function CompanyNavigation({ id }: { id: string }) {
  return <nav aria-label="Company"><Link href={`/company/${id}`}>Overview</Link><Link href={`/company/${id}/ownership`}>Ownership</Link>
    <Link href={`/company/${id}/grants`}>Grants</Link><Link href={`/company/${id}/approvals`}>Approvals</Link>
    <Link href={`/company/${id}/distributions`}>Distributions</Link><Link href={`/company/${id}/activity`}>Activity</Link>
    <Link href={`/me?company=${id}`}>My ownership</Link></nav>;
}

export function OwnershipSection({ totals, holdings }: { totals: Totals; holdings: Holding[] }) {
  return <section id="ownership"><h2>Ownership</h2><p>Issued percentages use issued units. Fully diluted percentages include the pool and reserved grants.</p>
    <table><thead><tr><th>Account</th><th>Issued units</th><th>Issued</th><th>Fully diluted</th></tr></thead><tbody>
      {holdings.map(h => <tr key={h.account_id}><td>{h.account_id}</td><td>{formatUnits(h.issued_units)}</td><td>{percent(h.issued_units, totals.issued_total)}</td><td>{percent(h.issued_units, totals.fully_diluted_total)}</td></tr>)}
    </tbody></table>{holdings.length === 0 && <p>No units issued yet.</p>}</section>;
}

export function GrantsSection({ id, grants }: { id: string; grants: Grant[] }) {
  return <section id="grants"><h2>Contributor grants</h2><div className="cards">
    {grants.map(g => <article key={g.id}><h3><Link href={`/company/${id}/grants/${g.id}`}>Grant #{g.id}</Link></h3><p>{g.recipient}</p><p>Granted {formatUnits(g.original_units)} · vested {formatUnits(g.vested_units)} · issued {formatUnits(g.issued_units)}</p><p>Claimable {formatUnits(g.claimable_units)} · remaining reservation {formatUnits((BigInt(g.entitlement_cap) - BigInt(g.issued_units)).toString())}</p><p>Start {new Date(g.boundaries[0] * 1000).toUTCString()} · cliff {new Date(g.boundaries[12] * 1000).toUTCString()} · fully vested {new Date(g.boundaries[48] * 1000).toUTCString()}</p><p>{g.cancelled_at ? `Cancelled ${new Date(g.cancelled_at * 1000).toUTCString()}; vested rights remain` : "Active"}</p><WalletControl contractId={id} grantId={g.id} recipient={g.recipient} claimable={g.claimable_units} /></article>)}
  </div>{grants.length === 0 && <p>No grants yet.</p>}</section>;
}

export function DistributionsSection({ id, distributions }: { id: string; distributions: Distribution[] }) {
  return <section id="distributions"><h2>Distributions</h2><div className="cards">
    {distributions.map(d => <article key={d.id}><h3><Link href={`/company/${id}/distributions/${d.id}`}>Distribution #{d.id}</Link></h3><p>{formatUnits(d.budget)} token base units · {d.token_id}</p><p>{d.cancelled ? "Cancelled" : d.funded ? "Funded" : d.approved ? "Approved, awaiting funding" : "Awaiting approval"}</p><p>Paid {formatUnits(d.paid_total)} · in flight {formatUnits(d.in_flight_total)} · available {formatUnits(d.available_escrow)}</p><p>Snapshot revision {d.snapshot_revision}</p><table><thead><tr><th>Recipient</th><th>Entitlement</th><th>Status</th></tr></thead><tbody>{d.entitlements.map(e => <tr key={e.account_id}><td>{e.account_id}</td><td>{formatUnits(e.amount)}</td><td>{e.payment_status}</td></tr>)}</tbody></table></article>)}
  </div>{distributions.length === 0 && <p>No distributions yet.</p>}</section>;
}
