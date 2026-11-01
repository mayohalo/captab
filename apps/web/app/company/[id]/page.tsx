import { CompanyView } from "../../../components/company-view";
import { readCompany, validAccountId } from "../../../lib/near";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validAccountId(id)) return <main><h1>Invalid company account</h1></main>;
  try { return <CompanyView id={id} {...await readCompany(id)} />; }
  catch (error) { return <main><h1>Company unavailable</h1><p>{error instanceof Error ? error.message : "Unable to load contract state"}</p><p>Check the contract ID and testnet deployment.</p></main>; }
}
