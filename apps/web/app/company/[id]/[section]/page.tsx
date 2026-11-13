import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyNavigation, DistributionsSection, GrantsSection, OwnershipSection } from "../../../../components/company-sections";
import { GovernancePanel } from "../../../../components/governance-panel";
import { DistributionOperator } from "../../../../components/distribution-operator";
import { RoundCalculator } from "../../../../components/round-calculator";
import { ExitWaterfall } from "../../../../components/exit-waterfall";
import { DealsSection } from "../../../../components/deals-section";
import { readCompany, validAccountId } from "../../../../lib/near";

export const dynamic = "force-dynamic";

const sections = ["ownership", "grants", "approvals", "distributions", "deals"] as const;

export default async function CompanySectionPage({ params }: { params: Promise<{ id: string; section: string }> }) {
  const { id, section } = await params;
  if (!validAccountId(id) || !sections.some(value => value === section)) notFound();
  try {
    const company = await readCompany(id);
    const governanceVerified = company.companyAssessment.verified && company.daoAssessment.verified;
    const governance = (initialAction: "founder" | "grant" | "approve" | "approveDeal") => <GovernancePanel id={id} totals={company.totals}
      config={company.config} policy={company.daoPolicy} governanceVerified={governanceVerified}
      proposals={company.proposals} grants={company.grants} distributions={company.distributions}
      deals={company.deals} rounds={company.rounds} initialAction={initialAction} />;
    return <main><header><div><Link href={`/company/${id}`}>← {id}</Link><h1>{section[0].toUpperCase() + section.slice(1)}</h1>
      <p>Schema v{company.config.schema_version} · DAO {company.config.dao_id} · ledger revision {company.totals.ledger_revision}</p></div></header>
      <CompanyNavigation id={id} />
      {company.config.paused && <p role="alert">Company is paused. New actions are unavailable.</p>}
      {!company.companyAssessment.verified && <p role="alert">Company verification failed: {company.companyAssessment.reason}</p>}
      {!company.daoAssessment.verified && <p role="alert">DAO verification failed: {company.daoAssessment.reason}</p>}
      {section === "ownership" && <><OwnershipSection id={id} totals={company.totals} holdings={company.holdings} />
        <RoundCalculator totals={company.totals} holdings={company.holdings} canAmend={company.config.schema_version === 2} />{governance("founder")}</>}
      {section === "grants" && <><GrantsSection id={id} grants={company.grants} companyVerified={company.companyAssessment.verified} />{governance("grant")}</>}
      {section === "approvals" && governance("founder")}
      {section === "deals" && <><DealsSection id={id} config={company.config} deals={company.deals} rounds={company.rounds}
        companyVerified={company.companyAssessment.verified} />{company.config.schema_version === 2 && governance("approveDeal")}</>}
      {section === "distributions" && <><DistributionsSection id={id} distributions={company.distributions}
        daoId={company.config.dao_id} tokenId={company.config.settlement_token_id} treasuryBalance={company.treasuryBalance} />
        <DistributionOperator id={id} config={company.config} policy={company.daoPolicy} governanceVerified={governanceVerified}
          totals={company.totals} distributions={company.distributions} />
        <ExitWaterfall holdings={company.holdings} grants={company.grants}
          tokenDecimals={company.config.schema_version === 2 ? company.tokenDecimals : null} />{governance("approve")}</>}
    </main>;
  } catch (error) {
    return <main><Link href={`/company/${id}`}>← {id}</Link><h1>Company unavailable</h1>
      <p>{error instanceof Error ? error.message : "Unable to load contract state"}</p></main>;
  }
}
