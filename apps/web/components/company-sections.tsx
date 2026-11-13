import Link from "next/link";
import { formatUnits, grantMilestones, percent, type CompanyConfig, type Deal, type Distribution, type Grant, type Holding, type Round, type Totals } from "../lib/near";
import { Pill } from "./brand";
import { CompanyNavLinks } from "./company-nav";
import { WalletControl } from "./wallet";

export function CompanyNavigation({ id }: { id: string }) {
  return <CompanyNavLinks id={id} />;
}

type StageState = "done" | "next" | "unavailable";

/** Where this company is on the founding-to-exit path, read only from its on-chain state. */
export function JourneyTracker({ config, totals, grants, distributions, deals, rounds }: {
  config: CompanyConfig; totals: Totals; grants: Grant[]; distributions: Distribution[]; deals: Deal[]; rounds: Round[];
}) {
  const v2 = config.schema_version === 2;
  const settled = (kind: Deal["kind"]) => deals.some(deal => deal.kind === kind && deal.status === "Settled");
  const stages: { title: string; tone: string; done: boolean; needsV2?: boolean; detail: string }[] = [
    { title: "Found", tone: "mint", done: totals.issued_total !== "0", detail: `${formatUnits(totals.issued_total)} issued` },
    { title: "Hire", tone: "mint", done: grants.length > 0, detail: `${grants.length} grant${grants.length === 1 ? "" : "s"}` },
    { title: "Raise", tone: "blue", done: rounds.length > 0 || settled("Issue"), needsV2: true, detail: `${rounds.length} round${rounds.length === 1 ? "" : "s"}` },
    { title: "Liquidity", tone: "violet", done: settled("Secondary") || settled("Buyback"), needsV2: true,
      detail: `${deals.filter(deal => deal.kind !== "Issue" && deal.status === "Settled").length} trades settled` },
    { title: "Pay holders", tone: "gold", done: distributions.some(d => d.paid_total !== "0"), detail: `${distributions.length} distribution${distributions.length === 1 ? "" : "s"}` },
    { title: "Exit", tone: "gold", done: Boolean(config.closed), needsV2: true, detail: config.closed ? "ledger closed" : "open" },
  ];
  return <section aria-label="Company journey"><ol className="tracker">{stages.map((stage, index) => {
    const state: StageState = stage.done ? "done" : stage.needsV2 && !v2 ? "unavailable" : "next";
    return <li key={stage.title} data-tone={stage.tone} data-state={state}>
      <div className="dot" aria-hidden="true">{stage.done ? "✓" : index + 1}</div>
      <strong>{stage.title}</strong><span>{state === "unavailable" ? "needs schema v2" : stage.detail}</span>
    </li>;
  })}</ol></section>;
}

/** Authorized units split into issued, granted, pool, investor-reserved, and still unallocated. */
export function CapTableBar({ totals }: { totals: Totals }) {
  const authorized = BigInt(totals.authorized_units);
  const parts = [
    { label: "Issued", value: totals.issued_total, tone: "mint" },
    { label: "Reserved for grants", value: totals.grant_reserved, tone: "blue" },
    { label: "Pool", value: totals.pool_available, tone: "violet" },
    { label: "Reserved for investors", value: totals.deal_reserved ?? "0", tone: "gold" },
  ].filter(part => part.value !== "0");
  const width = (value: string) => authorized ? `${Number((BigInt(value) * 100_000n) / authorized) / 1000}%` : "0%";
  return <div aria-label="Authorized units">
    <div className="captable-bar" role="img" aria-label={parts.map(part => `${part.label} ${percent(part.value, totals.authorized_units)}`).join(", ")}>
      {parts.map(part => <span key={part.label} data-tone={part.tone} style={{ width: width(part.value) }} />)}
    </div>
    <ul className="captable-legend">
      {parts.map(part => <li key={part.label} data-tone={part.tone}><i />{part.label} <b>{formatUnits(part.value)}</b></li>)}
      <li data-tone="none"><i />Unallocated <b>{formatUnits(totals.unallocated_units)}</b></li>
      <li>of <b>{formatUnits(totals.authorized_units)}</b> authorized</li>
    </ul>
  </div>;
}

export function OwnershipSection({ id, totals, holdings }: { id: string; totals: Totals; holdings: Holding[] }) {
  const showLocked = holdings.some(h => h.locked_units && h.locked_units !== "0");
  return <section id="ownership"><h2>Ownership</h2><p>Issued percentages use issued units. Fully diluted percentages include the pool and reserved grants.</p>
    <CapTableBar totals={totals} />
    <p className="export-links">Export cap table at revision {totals.ledger_revision}: <a href={`/api/companies/${id}/export?format=csv`} download>CSV</a> · <a href={`/api/companies/${id}/export?format=json`} download>JSON</a></p>
    <div className="table-scroll" role="region" aria-label="Ownership table" tabIndex={0}><table><thead><tr><th>Account</th><th>Issued units</th><th>Issued</th><th>Fully diluted</th>{showLocked && <th>Locked in deals</th>}</tr></thead><tbody>
      {holdings.map(h => <tr key={h.account_id}><td>{h.account_id}</td><td>{formatUnits(h.issued_units)}</td><td>{percent(h.issued_units, totals.issued_total)}</td><td>{percent(h.issued_units, totals.fully_diluted_total)}</td>
        {showLocked && <td>{formatUnits(h.locked_units ?? "0")}</td>}</tr>)}
    </tbody></table></div>{holdings.length === 0 && <p>No units issued yet.</p>}</section>;
}

export function GrantsSection({ id, grants, companyVerified }: { id: string; grants: Grant[]; companyVerified: boolean }) {
  return <section id="grants"><h2>Contributor grants</h2><div className="cards">
    {grants.map(g => <article key={g.id}><h3><Link href={`/company/${id}/grants/${g.id}`}>Grant #{g.id}</Link></h3><p>{g.recipient}</p><p>Granted {formatUnits(g.original_units)} · vested {formatUnits(g.vested_units)} · issued {formatUnits(g.issued_units)}</p><p>Claimable {formatUnits(g.claimable_units)} · remaining reservation {formatUnits((BigInt(g.entitlement_cap) - BigInt(g.issued_units)).toString())}</p><p>Start {new Date(grantMilestones(g).start * 1000).toUTCString()} · {grantMilestones(g).cliffIndex ? `cliff ${new Date(grantMilestones(g).cliff * 1000).toUTCString()}` : "no cliff"} · fully vested {new Date(grantMilestones(g).end * 1000).toUTCString()} ({grantMilestones(g).months} months{g.accelerated_months ? `, ${g.accelerated_months} accelerated` : ""}{g.source === "Unallocated" ? ", founder grant" : ""})</p><p>{g.cancelled_at ? <><Pill status="Cancelled" /> {`Cancelled ${new Date(g.cancelled_at * 1000).toUTCString()}; vested rights remain`}</> : <Pill status="Active" />}</p><WalletControl contractId={id} grantId={g.id} recipient={g.recipient} claimable={g.claimable_units} companyVerified={companyVerified}
      termsHash={g.doc_hash ?? undefined} accepted={Boolean(g.accepted_terms_hash)} /></article>)}
  </div>{grants.length === 0 && <p>No grants yet.</p>}</section>;
}

export function distributionState(d: Distribution) {
  return d.cancelled ? "Cancelled" : d.funded ? "Funded" : d.approved ? "Approved, awaiting funding" : "Awaiting approval";
}

export function DistributionsSection({ id, distributions, daoId, tokenId, treasuryBalance }: {
  id: string; distributions: Distribution[]; daoId: string; tokenId: string; treasuryBalance: string | null;
}) {
  return <section id="distributions"><h2>Distributions</h2>
    <p>DAO treasury {daoId}: {treasuryBalance === null ? "token balance unavailable" : `${formatUnits(treasuryBalance)} token base units`} · {tokenId}. Funding proposals transfer the exact approved budget from this account.</p>
    <div className="cards">
    {distributions.map(d => <article key={d.id}><h3><Link href={`/company/${id}/distributions/${d.id}`}>Distribution #{d.id}</Link></h3><p>{formatUnits(d.budget)} token base units · {d.token_id}</p><p><Pill status={distributionState(d)} tone={d.cancelled ? "muted" : d.funded ? "good" : d.approved ? "info" : "warn"} /></p><p>Paid {formatUnits(d.paid_total)} · in flight {formatUnits(d.in_flight_total)} · available {formatUnits(d.available_escrow)}</p><p>Snapshot revision {d.snapshot_revision}</p><div className="table-scroll" role="region" aria-label={`Distribution ${d.id} entitlements`} tabIndex={0}><table><thead><tr><th>Recipient</th><th>Entitlement</th><th>Status</th></tr></thead><tbody>{d.entitlements.map(e => <tr key={e.account_id}><td>{e.account_id}</td><td>{formatUnits(e.amount)}</td><td><Pill status={e.payment_status} /></td></tr>)}</tbody></table></div></article>)}
  </div>{distributions.length === 0 && <p>No distributions yet.</p>}</section>;
}
