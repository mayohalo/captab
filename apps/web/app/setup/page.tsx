import Link from "next/link";
import { JsonRpcProvider } from "near-api-js";
import { readCompany, validAccountId } from "../../lib/near";

export const dynamic = "force-dynamic";

const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org" });

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const selected = company || process.env.NEXT_PUBLIC_COMPANY_CONTRACT_ID || "";
  let inspection: Awaited<ReturnType<typeof readCompany>> | null = null;
  let codeHash: string | null = null;
  let token: { symbol?: string; decimals?: number } | null = null;
  let error: string | null = null;
  if (selected) {
    if (!validAccountId(selected)) error = "Enter a valid NEAR testnet account ID.";
    else try {
      inspection = await readCompany(selected);
      const [code, metadata] = await Promise.all([
        provider.viewContractCode({ contractId: selected }),
        provider.callFunction({ contractId: inspection.config.settlement_token_id, method: "ft_metadata", args: {} }),
      ]);
      codeHash = code.hash;
      token = metadata as { symbol?: string; decimals?: number };
    } catch (cause) { error = cause instanceof Error ? cause.message : "Company inspection failed"; }
  }
  const council = inspection?.daoPolicy?.roles.find(role => role.name === "council")?.kind.Group ?? [];
  const proposalStates = inspection?.proposals.map(proposal => proposal.status) ?? [];
  return <main><header><div><Link href="/">CapTable</Link><h1>Company setup</h1><p>NEAR testnet · attach a pre-created Sputnik DAO and company account.</p></div></header>
    <section><h2>Inspect company</h2><form className="governance-form" action="/setup" method="get">
      <label>Company contract account<input name="company" defaultValue={selected} placeholder="company.testnet" required /></label>
      <button>Inspect on-chain setup</button>
    </form></section>
    {error && <section><p role="alert">{error}</p><p>Deploy the pinned company WASM and initialize it with an existing three-member Sputnik DAO, then inspect again.</p></section>}
    {inspection && <><section className="cards">
      <article><h2>Company contract</h2><p>{selected}</p><p>Code hash: <code>{codeHash}</code></p><p>Schema v{inspection.config.schema_version} · limits {inspection.config.limits.max_holders} holders, {inspection.config.limits.max_grants} grants, {inspection.config.limits.max_distributions} distributions, {inspection.config.limits.max_actions} actions</p><p>Authorized {inspection.config.authorized_units} units · issued {inspection.totals.issued_total}</p><p>{inspection.config.paused ? "Paused" : "Active"}</p></article>
      <article><h2>Governance</h2><p>DAO: {inspection.config.dao_id}</p><p>Council accounts: {council.length} {council.length === 3 ? "(expected)" : "(check policy)"}</p><p>{inspection.daoPolicy ? `Proposal bond: ${inspection.daoPolicy.proposal_bond} yoctoNEAR` : "DAO policy unavailable"}</p></article>
      <p role={inspection.daoAssessment.verified ? undefined : "alert"}>{inspection.daoAssessment.reason}</p>
      <article><h2>Settlement</h2><p>Token: {inspection.config.settlement_token_id}</p><p>{token?.symbol ?? "Unknown token"} · {token?.decimals ?? "?"} decimals</p><p>DAO token balance: {inspection.treasuryBalance === null ? "unavailable" : `${inspection.treasuryBalance} base units`}</p><p>Snapshot operator: {inspection.config.snapshot_operator_id}</p></article>
    </section><section><h2>Next steps</h2><p>Founder issuance and contributor pool allocation are live DAO proposals. The company page prepares each action for wallet review and council voting.</p>
      {proposalStates.includes("InProgress") && <p>At least one DAO proposal is awaiting votes.</p>}
      {proposalStates.includes("Failed") && <p role="alert">A DAO proposal failed; inspect its receipts before retrying.</p>}
      <Link className="button" href={`/company/${selected}`}>Open company governance</Link>
    </section></>}
    <section><h2>Deploy a new demo company</h2><p>Build the pinned Sputnik, company, and TESTUSD WASM. Prepare three board accounts plus DAO, token, operator, and funded company accounts. Run <code>pnpm bootstrap:dao</code>, <code>pnpm bootstrap:token</code>, and <code>pnpm deploy:testnet</code> for read-only preflights. After reviewing each result, repeat the same pnpm commands with <code>--apply</code> as shown in the runbook. The final command verifies code hashes, initializes the company, registers it with the token, and writes a public deployment manifest.</p></section>
  </main>;
}
