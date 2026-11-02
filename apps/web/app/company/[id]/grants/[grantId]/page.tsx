import Link from "next/link";
import { CompanyNavigation, GrantsSection } from "../../../../../components/company-sections";
import { GovernancePanel } from "../../../../../components/governance-panel";
import { readCompany, validAccountId } from "../../../../../lib/near";

export const dynamic = "force-dynamic";

export default async function GrantPage({ params }: { params: Promise<{ id: string; grantId: string }> }) {
  const { id, grantId } = await params;
  if (!validAccountId(id) || !/^(0|[1-9]\d*)$/.test(grantId)) return <main><h1>Invalid grant</h1></main>;
  try {
    const company = await readCompany(id);
    const grant = company.grants.find(item => item.id === Number(grantId));
    if (!grant) return <main><Link href={`/company/${id}/grants`}>← Grants</Link><h1>Grant not found</h1></main>;
    return <main><header><div><Link href={`/company/${id}/grants`}>← Grants</Link><h1>Grant #{grant.id}</h1>
      <p>NEAR testnet · {grant.recipient} · ledger revision {company.totals.ledger_revision}</p></div></header>
      <CompanyNavigation id={id} />
      {!company.companyAssessment.verified && <p role="alert">Company verification failed: {company.companyAssessment.reason}</p>}
      <GrantsSection id={id} grants={[grant]} companyVerified={company.companyAssessment.verified} />
      <GovernancePanel id={id} totals={company.totals} config={company.config} policy={company.daoPolicy}
        governanceVerified={company.companyAssessment.verified && company.daoAssessment.verified} proposals={company.proposals} grants={[grant]}
        distributions={company.distributions} initialAction="cancelGrant" />
    </main>;
  } catch (error) { return <main><h1>Grant unavailable</h1><p>{error instanceof Error ? error.message : "Unable to load grant"}</p></main>; }
}
