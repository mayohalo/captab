import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyNavigation, DistributionsSection, GrantsSection, OwnershipSection } from "../../../../components/company-sections";
import { GovernancePanel } from "../../../../components/governance-panel";
import { DistributionOperator } from "../../../../components/distribution-operator";
import { readCompany, validAccountId } from "../../../../lib/near";

export const dynamic = "force-dynamic";

const sections = ["ownership", "grants", "approvals", "distributions"] as const;

export default async function CompanySectionPage({ params }: { params: Promise<{ id: string; section: string }> }) {
  const { id, section } = await params;
  if (!validAccountId(id) || !sections.some(value => value === section)) notFound();
  try {
    const company = await readCompany(id);
    const governance = (initialAction: "founder" | "grant" | "approve") => <GovernancePanel id={id} totals={company.totals}
      config={company.config} policy={company.daoPolicy} daoVerified={company.daoAssessment.verified}
      proposals={company.proposals} grants={company.grants} distributions={company.distributions} initialAction={initialAction} />;
    return <main><header><div><Link href={`/company/${id}`}>← {id}</Link><h1>{section[0].toUpperCase() + section.slice(1)}</h1>
      <p>NEAR testnet · DAO {company.config.dao_id} · ledger revision {company.totals.ledger_revision}</p></div></header>
      <CompanyNavigation id={id} />
      {company.config.paused && <p role="alert">Company is paused. New actions are unavailable.</p>}
      {!company.daoAssessment.verified && <p role="alert">DAO verification failed: {company.daoAssessment.reason}</p>}
      {section === "ownership" && <><OwnershipSection totals={company.totals} holdings={company.holdings} />{governance("founder")}</>}
      {section === "grants" && <><GrantsSection id={id} grants={company.grants} />{governance("grant")}</>}
      {section === "approvals" && governance("founder")}
      {section === "distributions" && <><DistributionsSection id={id} distributions={company.distributions} />
        <DistributionOperator id={id} config={company.config} policy={company.daoPolicy} daoVerified={company.daoAssessment.verified}
          totals={company.totals} distributions={company.distributions} />{governance("approve")}</>}
    </main>;
  } catch (error) {
    return <main><Link href={`/company/${id}`}>← {id}</Link><h1>Company unavailable</h1>
      <p>{error instanceof Error ? error.message : "Unable to load contract state"}</p></main>;
  }
}
