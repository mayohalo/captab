import Link from "next/link";
import { HornLogo, Pill } from "../components/brand";
import { CapTableBar } from "../components/company-sections";
import { ArchitectureDiagram } from "../components/landing-diagram";
import { DEPLOYMENTS, LIVE_STEPS, TEST_COUNTS, accountUrl, txUrl } from "../lib/evidence";
import { formatUnits, readCompany } from "../lib/near";

// The page is static and refreshed from chain at most every five minutes, so visitors never wait on the RPC.
export const revalidate = 300;

const STAGES = [
  { tone: "mint", title: "Found", outcome: "Split ownership between founders, vest it, and record the agreement.",
    how: "The founders' agreement is fingerprinted on chain; founder units can vest like anyone else's.", methods: ["issue_founder_units", "increase_authorized"], status: "Live" },
  { tone: "mint", title: "Hire", outcome: "Give contributors equity that vests monthly, with terms they sign.",
    how: "Any cliff, 1–120 months. Contributors claim with zero NEAR through a sponsored relayer.", methods: ["create_grant", "accept_grant", "claim_vested"], status: "Live" },
  { tone: "blue", title: "Raise", outcome: "Sell new units to investors at a round price; they pay and receive in one step.",
    how: "Wrong amounts or payers are refunded by the token. The money lands in the DAO treasury.", methods: ["create_round", "approve_deal", "ft_transfer_call"], status: "Live · v2" },
  { tone: "blue", title: "Operate", outcome: "Run the company's ownership with board votes and an audit-ready record.",
    how: "Replay-safe actions, corrections, lost-wallet recovery, CSV/JSON export with a SHA-256.", methods: ["retire_units", "reassign_holding"], status: "Live" },
  { tone: "violet", title: "Liquidity", outcome: "Let early holders sell to new buyers, or sell back to the company.",
    how: "A unit moves only with the board's approval and the holder's signature.", methods: ["accept_deal", "forward_proceeds"], status: "Live · v2" },
  { tone: "gold", title: "Pay holders", outcome: "Distribute money to holders, exactly and once.",
    how: "Payouts sum to the budget, are funded once by the DAO, and are retry-safe per holder.", methods: ["prepare_distribution", "pay_recipient"], status: "Live" },
  { tone: "gold", title: "Exit", outcome: "Split sale proceeds by preference, accelerate vesting, close the books.",
    how: "An exit waterfall becomes an explicit payout list; the closed ledger can never reopen.", methods: ["prepare_explicit_distribution", "close_company"], status: "Live · close in Sandbox" },
] as const;

async function liveCompany(id: string | undefined) {
  if (!id) return null;
  try {
    const company = await readCompany(id);
    const settledTrades = company.deals?.filter(deal => deal.status === "Settled").length ?? 0;
    return { id, company, settledTrades };
  } catch { return null; }
}

export default async function Home() {
  const configured = process.env.NEXT_PUBLIC_COMPANY_CONTRACT_ID;
  const live = await liveCompany(configured);
  const site = process.env.CAPTAB_AUTH_ORIGIN;
  const jsonLd = {
    "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Captab", applicationCategory: "FinanceApplication",
    operatingSystem: "Web", description: "A company's cap table (who owns what) kept in a NEAR smart contract and governed by a DAO board: founder issuance, vesting grants, priced rounds, secondary sales, buybacks, exact payouts, and exit. Testnet prototype.",
    ...(site ? { url: site } : {}), offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  return <main className="home">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

    <section className="hero" aria-labelledby="home-title">
      <HornLogo size={168} animated />
      <div>
        <p className="eyebrow">Cap tables on NEAR</p>
        <h1 id="home-title">Captab</h1>
        <p className="tagline">From day zero <em className="iridescent">to unicorn.</em></p>
        <p className="intro">Captab keeps a company&apos;s cap table, the record of who owns what, in a NEAR smart contract run by a DAO board.
          Founders, employees, and investors can verify their own stake, and money moves in the same transaction as the ownership it pays for.</p>
        <div className="hero-actions">
          {configured ? <Link className="button" href={`/company/${configured}`}>Explore the live company</Link> : null}
          <a className="button ghost" href="#proof">See the evidence</a>
          <a className="button ghost" href="#how">How it works</a>
        </div>
        <span className="disclaimer">NEAR testnet prototype · units are ledger records, not legal shares · all holders are fictional</span>
      </div>
    </section>

    <section id="cap-table" className="landing-split" aria-labelledby="cap-table-title">
      <div>
        <h2 id="cap-table-title">What is a cap table?</h2>
        <p className="lead">A capitalization table lists who owns a company: founders, employees with vesting grants, investors, and the pool reserved for future hires.</p>
        <p>It decides who gets paid when the company is sold, how much each new investor dilutes everyone else, and whether an employee&apos;s equity has vested.
          Most companies keep it in a spreadsheet or a private database, so every holder has to trust whoever keeps the file.</p>
      </div>
      <article aria-label="Live cap table">
        {live ? <>
          <h3>This company&apos;s cap table, live from chain</h3>
          <CapTableBar totals={live.company.totals} />
          <p className="small"><Link href={`/company/${live.id}/ownership`}>{live.id}</Link> · ledger revision {live.company.totals.ledger_revision}</p>
        </> : <>
          <h3>Example</h3>
          <CapTableBar totals={{ dao_id: "", authorized_units: "10000000", issued_total: "6000000", grant_reserved: "500000", pool_available: "1500000", deal_reserved: "1000000",
            fully_diluted_total: "9000000", unallocated_units: "1000000", ledger_revision: 0, holder_count: 0 }} />
          <p className="small">Live figures are temporarily unavailable.</p>
        </>}
      </article>
    </section>

    <section id="why" aria-labelledby="why-title">
      <h2 id="why-title">Why put it on-chain</h2>
      <div className="three-up">
        <article data-tone="mint"><h3>The board votes on-chain</h3><p>The board is a two-of-three council on a Sputnik DAO. Every issuance, grant, round, deal, and payout is a proposal it votes on, and the company contract accepts changes only from the DAO.</p></article>
        <article data-tone="blue"><h3>The rules are code</h3><p>Supply never exceeds what is authorized, vesting follows its schedule, an action cannot be replayed, and no unit moves without the holder&apos;s signature. Anyone can check the ledger against the rules.</p></article>
        <article data-tone="gold"><h3>Money moves with ownership</h3><p>An investor&apos;s payment issues their units in the same transaction, or is refunded. Payouts sum exactly to the budget and pay each holder once, even when a transfer fails and is retried.</p></article>
      </div>
    </section>

    <section id="journey" aria-labelledby="journey-title">
      <h2 id="journey-title">From day zero to exit</h2>
      <p>Seven stages a company goes through, each a set of contract calls. Stages marked v2 need a company on contract schema 2.</p>
      <ol className="journey">
        {STAGES.map((stage, index) => <li key={stage.title} data-tone={stage.tone}>
          <div className="stage-head"><span className="stage-num">{index + 1}</span><h3>{stage.title}</h3></div>
          <p className="outcome">{stage.outcome}</p>
          <p>{stage.how}</p>
          <div className="methods" aria-label="Contract calls">{stage.methods.map(method => <code key={method}>{method}</code>)}</div>
          <Pill status={stage.status} tone="good" />
        </li>)}
      </ol>
    </section>

    <section id="privacy" aria-labelledby="privacy-title">
      <h2 id="privacy-title">Transparent where it matters, private where it should be</h2>
      <div className="three-up">
        <article data-tone="mint"><h3>Public and verifiable</h3><p>Units per account, grants and vesting, rounds and prices, deals, payouts, and every board vote. Anyone can audit them on NEAR.</p></article>
        <article data-tone="violet"><h3>Private</h3><p>The names and emails behind account IDs stay off-chain. Council members see them after signing in with their wallet; every other holder sees only their own.</p></article>
        <article data-tone="gold"><h3>Fingerprinted only</h3><p>The charter, grant agreements, and purchase agreements stay with the company. Only their SHA-256 goes on chain, so anyone holding a copy can prove it is the approved version.</p></article>
      </div>
      <p className="note">Honest limit: amounts are public today; only identities are private. Confidential balances are on the roadmap.</p>
    </section>

    <section id="tokenization" aria-labelledby="tokenization-title">
      <h2 id="tokenization-title">Ownership ledger today, share tokens next</h2>
      <p>Real equity cannot trade freely: transfers need the company&apos;s consent and the holder&apos;s. So Captab starts with an on-chain ledger that enforces those rules, then adds tokens on top of it.</p>
      <ol className="stepper">
        <li data-state="done"><strong>Built: on-chain ownership ledger</strong><span>Issuance, vesting, priced rounds, secondary sales, buybacks, and payouts, each approved by the board and signed by the holder.</span><Pill status="Live on testnet" tone="good" /></li>
        <li><strong>Next: restricted share tokens</strong><span>One NEP-141 token per share class, visible in wallets, with a transfer guard that enforces the same approvals. The ledger migrates once, from a hashed export.</span><Pill status="Designed" tone="info" /></li>
        <li><strong>Later: legal shares</strong><span>Legal wrappers that make on-chain units the company&apos;s source of truth, with confidential amounts.</span><Pill status="Future" tone="muted" /></li>
      </ol>
    </section>

    <section id="proof" aria-labelledby="proof-title">
      <h2 id="proof-title">Proof, not promises</h2>
      {live ? <div className="metrics">
        <article data-tone="mint"><span>Units issued</span><strong>{formatUnits(live.company.totals.issued_total)}</strong></article>
        <article data-tone="blue"><span>Holders</span><strong>{live.company.holdings.length}</strong></article>
        <article data-tone="violet"><span>Ledger changes</span><strong>{live.company.totals.ledger_revision}</strong></article>
        <article data-tone="gold"><span>Deals settled</span><strong>{live.settledTrades}</strong></article>
        <article><span>Contract and DAO</span><strong className="verify">{live.company.companyAssessment.verified && live.company.daoAssessment.verified ? "Verified" : "Unverified"}</strong></article>
      </div> : <p>Live figures are temporarily unavailable; the transactions below are final on NEAR testnet.</p>}
      <h3>Every stage, run live on testnet</h3>
      <div className="table-scroll" role="region" aria-label="Live testnet transactions" tabIndex={0}><table>
        <thead><tr><th>Stage</th><th>What happened</th><th>Transactions</th></tr></thead>
        <tbody>{LIVE_STEPS.map(step => <tr key={step.what}><td><strong>{step.stage}</strong></td><td>{step.what}</td>
          <td className="tx-links">{step.links.map(link => <a key={link.tx} href={txUrl(link.tx)}>{link.label}</a>)}</td></tr>)}</tbody>
      </table></div>
      <div className="three-up tests">{TEST_COUNTS.map(test => <article key={test.label}><strong>{test.value}</strong><span>{test.label}</span><p>{test.detail}</p></article>)}</div>
      <p className="small">Contracts: <a href={accountUrl(DEPLOYMENTS.v2.company)}>{DEPLOYMENTS.v2.company}</a> (company), <a href={accountUrl(DEPLOYMENTS.v2.dao)}>{DEPLOYMENTS.v2.dao}</a> (board),
        {" "}<a href={accountUrl(DEPLOYMENTS.v2.token)}>{DEPLOYMENTS.v2.token}</a> (TESTUSD). An earlier v1 deployment, <a href={accountUrl(DEPLOYMENTS.v1.company)}>{DEPLOYMENTS.v1.company}</a>, ran the original payout and zero-NEAR claim rehearsals.</p>
    </section>

    <section id="how" aria-labelledby="how-title">
      <h2 id="how-title">How it is built</h2>
      <ArchitectureDiagram />
      <ul className="stack">
        <li><code>near-sdk 5.17</code> Rust company contract</li><li>pinned <code>Sputnik DAO</code> board</li>
        <li><code>NEP-141</code> payments with <code>ft_transfer_call</code></li><li><code>NEP-366</code> gasless claims</li>
        <li><code>NEP-413</code> wallet sign-in</li><li><code>NEP-297</code> events</li><li><code>Next.js</code> app, SQLite worker</li>
      </ul>
    </section>

    <section id="impact" aria-labelledby="impact-title">
      <h2 id="impact-title">Who it helps</h2>
      <div className="four-up">
        <article data-tone="mint"><h3>Founders anywhere</h3><p>An auditable cap table with built-in payouts from one deployable contract, without paying for equity software or waiting on local legal infrastructure.</p></article>
        <article data-tone="blue"><h3>Contributors and employees</h3><p>Vesting they can verify themselves, claims that cost them nothing, and a path to cash through board-approved secondary sales.</p></article>
        <article data-tone="violet"><h3>Investors</h3><p>A valuation trail for every round and settlement in the same transaction, so there is nothing to reconcile.</p></article>
        <article data-tone="gold"><h3>DAOs, open source, co-ops</h3><p>Equity-like units for contributors, governed by the community&apos;s own council and enforced by code.</p></article>
      </div>
      <h3>What comes next</h3>
      <ul className="roadmap">
        <li><Pill status="Next" tone="info" />Sign the deal flows with third-party wallet extensions.</li>
        <li><Pill status="Next" tone="info" />Restricted share tokens per class, migrated from the ledger.</li>
        <li><Pill status="Next" tone="info" />One-click company deployment through a factory contract, and a history indexer.</li>
        <li><Pill status="Future" tone="muted" />Confidential amounts, stock options with an exercise price, SAFEs and convertible notes.</li>
        <li><Pill status="Future" tone="muted" />AI agents as operators or council members, held to the same DAO rules as people.</li>
      </ul>
    </section>

    <section id="limits" aria-labelledby="limits-title">
      <h2 id="limits-title">Honest limits</h2>
      <ul className="limits">
        <li>Testnet prototype. Units are on-chain records, not legal shares, and TESTUSD is a demo token. An IPO itself happens off-chain: Captab hands the transfer agent or acquirer a verifiable export, pays the proceeds, and closes the ledger.</li>
        <li>Closing a company is proven on a local NEAR Sandbox chain; the live company stays open as a demo.</li>
        <li>Signing so far used local test keys; third-party wallet extensions are not yet verified.</li>
        <li>The activity history covers transactions submitted through this app; contract views are always the source of truth.</li>
      </ul>
      <p className="small"><Link href="/setup">Inspect or deploy a company</Link> · For agents: a plain-text summary is at <a href="/llms.txt">/llms.txt</a>.</p>
    </section>
  </main>;
}
