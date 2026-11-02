import Link from "next/link";
import { CompanyNavigation, DistributionsSection } from "../../../../../components/company-sections";
import { DistributionOperator } from "../../../../../components/distribution-operator";
import { GovernancePanel } from "../../../../../components/governance-panel";
import { readCompany, validAccountId } from "../../../../../lib/near";

export const dynamic = "force-dynamic";

export default async function DistributionPage({ params }: { params: Promise<{ id: string; distributionId: string }> }) {
  const { id, distributionId } = await params;
  if (!validAccountId(id) || !/^(0|[1-9]\d*)$/.test(distributionId)) return <main><h1>Invalid distribution</h1></main>;
  try {
    const company = await readCompany(id);
    const distribution = company.distributions.find(item => item.id === Number(distributionId));
    if (!distribution) return <main><Link href={`/company/${id}/distributions`}>← Distributions</Link><h1>Distribution not found</h1></main>;
    return <main><header><div><Link href={`/company/${id}/distributions`}>← Distributions</Link><h1>Distribution #{distribution.id}</h1>
      <p>NEAR testnet · snapshot revision {distribution.snapshot_revision} · settlement token {distribution.token_id}</p></div></header>
      <CompanyNavigation id={id} />
      <DistributionsSection id={id} distributions={[distribution]} daoId={company.config.dao_id}
        tokenId={company.config.settlement_token_id} treasuryBalance={company.treasuryBalance} />
      <DistributionOperator id={id} config={company.config} policy={company.daoPolicy}
        daoVerified={company.daoAssessment.verified} totals={company.totals} distributions={[distribution]} />
      <GovernancePanel id={id} totals={company.totals} config={company.config} policy={company.daoPolicy}
        daoVerified={company.daoAssessment.verified} proposals={company.proposals} grants={company.grants}
        distributions={[distribution]} initialAction={distribution.approved ? "fund" : "approve"} />
    </main>;
  } catch (error) { return <main><h1>Distribution unavailable</h1><p>{error instanceof Error ? error.message : "Unable to load distribution"}</p></main>; }
}
