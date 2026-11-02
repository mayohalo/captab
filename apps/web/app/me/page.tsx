import Link from "next/link";
import { PersonalView } from "../../components/personal-view";
import { readCompany, validAccountId } from "../../lib/near";

export const dynamic = "force-dynamic";

export default async function MePage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  if (!company || !validAccountId(company)) return <main><h1>My ownership</h1><p>Open a company first, then select “My ownership”.</p><Link href="/">Find company</Link></main>;
  try {
    const { holdings, grants, distributions, companyAssessment } = await readCompany(company);
    return <PersonalView companyId={company} holdings={holdings} grants={grants} distributions={distributions} companyVerified={companyAssessment.verified} />;
  } catch (error) {
    return <main><h1>Company unavailable</h1><p>{error instanceof Error ? error.message : "Unable to load company"}</p><Link href={`/company/${company}`}>Back to company</Link></main>;
  }
}
