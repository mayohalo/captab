import Link from "next/link";
import { formatUnits, type CompanyCodeAssessment, type CompanyConfig, type DaoAssessment, type DaoPolicy, type DaoProposal, type Deal, type Distribution, type Grant, type Holding, type Round, type Totals } from "../lib/near";
import { GovernancePanel } from "./governance-panel";
import { DistributionOperator } from "./distribution-operator";
import { WalletControl } from "./wallet";
import { PrivateProfiles } from "./private-profiles";
import { CompanyNavigation, DistributionsSection, GrantsSection, OwnershipSection } from "./company-sections";

export function CompanyView({ id, totals, config, companyAssessment, daoPolicy, daoAssessment, proposals, holdings, grants, distributions, deals = [], rounds = [], treasuryBalance }: {
  id: string; totals: Totals; config: CompanyConfig; companyAssessment: CompanyCodeAssessment; daoPolicy: DaoPolicy | null; daoAssessment: DaoAssessment; proposals: DaoProposal[]; holdings: Holding[]; grants: Grant[]; distributions: Distribution[]; deals?: Deal[]; rounds?: Round[]; treasuryBalance: string | null;
}) {
  const governanceVerified = companyAssessment.verified && daoAssessment.verified;
  return <main>
    <header><div><Link href="/">CapTable</Link><h1>{id}</h1><p>NEAR testnet · DAO {totals.dao_id} · ledger revision {totals.ledger_revision}</p></div><WalletControl /></header>
    <CompanyNavigation id={id} />
    {config.closed && <p role="alert">Company is closed. The ledger is final; only views remain.</p>}
    {config.paused && <p role="alert">Company is paused. New claims, snapshots, funding, and payment attempts are disabled.</p>}
    {!companyAssessment.verified && <p role="alert">Company verification failed: {companyAssessment.reason} Governance and execution controls are unavailable.</p>}
    {!daoAssessment.verified && <p role="alert">DAO verification failed: {daoAssessment.reason} Governance controls are unavailable.</p>}
    <section className="metrics">
      <article><span>Issued</span><strong>{formatUnits(totals.issued_total)}</strong></article>
      <article><span>Fully diluted</span><strong>{formatUnits(totals.fully_diluted_total)}</strong></article>
      <article><span>Available pool</span><strong>{formatUnits(totals.pool_available)}</strong></article>
      <article><span>Unallocated</span><strong>{formatUnits(totals.unallocated_units)}</strong></article>
      {totals.deal_reserved && totals.deal_reserved !== "0" && <article><span>Reserved for investors</span><strong>{formatUnits(totals.deal_reserved)}</strong></article>}
    </section>
    <OwnershipSection id={id} totals={totals} holdings={holdings} />
    <GrantsSection id={id} grants={grants} companyVerified={companyAssessment.verified} />
    <DistributionsSection id={id} distributions={distributions} daoId={config.dao_id} tokenId={config.settlement_token_id} treasuryBalance={treasuryBalance} />
    <DistributionOperator id={id} config={config} policy={daoPolicy} governanceVerified={governanceVerified} totals={totals} distributions={distributions} />
    <GovernancePanel id={id} totals={totals} config={config} policy={daoPolicy} governanceVerified={governanceVerified} proposals={proposals} grants={grants} distributions={distributions} deals={deals} rounds={rounds} />
    <PrivateProfiles companyId={id} />
    <footer><a href={`https://testnet.nearblocks.io/address/${id}`}>View contract on NEAR Blocks</a></footer>
  </main>;
}
