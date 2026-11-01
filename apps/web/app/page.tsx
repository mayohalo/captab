import Link from "next/link";

export default function Home() {
  const configured = process.env.NEXT_PUBLIC_COMPANY_CONTRACT_ID;
  return <main className="home"><p className="eyebrow">NEAR TESTNET</p><h1>CapTable</h1><p className="intro">Company ownership, contributor vesting, and distributions governed on NEAR.</p>
    {configured ? <Link className="button" href={`/company/${configured}`}>Open company</Link> : <p>Set <code>NEXT_PUBLIC_COMPANY_CONTRACT_ID</code> to a deployed company account to view its live ledger.</p>}
    <p><Link href="/setup">Inspect or deploy a company</Link></p>
  </main>;
}
