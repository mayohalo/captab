import Link from "next/link";
import { HornLogo, Pill } from "../components/brand";

const STAGES = [
  { tone: "mint", title: "Found", text: "Authorized units, the founder split with its agreement's fingerprint, and founder vesting. The DAO council is the board.",
    methods: ["issue_founder_units", "increase_authorized"], status: "Live" },
  { tone: "mint", title: "Hire", text: "An equity pool and grants with any cliff and monthly vesting. Contributors sign their terms and claim with zero NEAR.",
    methods: ["create_grant", "accept_grant", "claim_vested"], status: "Live" },
  { tone: "blue", title: "Raise", text: "Priced rounds. Each investor pays and receives units in one transaction; the money lands in the DAO treasury.",
    methods: ["create_round", "approve_deal", "ft_transfer_call"], status: "Live · v2" },
  { tone: "blue", title: "Operate", text: "Every change is a DAO vote. Correct errors, recover lost wallets, and export an audit-ready cap table.",
    methods: ["retire_units", "reassign_holding"], status: "Live" },
  { tone: "violet", title: "Liquidity", text: "Secondary sales and buybacks. No unit moves without both the board's approval and the holder's signature.",
    methods: ["accept_deal", "forward_proceeds"], status: "Live · v2" },
  { tone: "gold", title: "Pay holders", text: "Distributions that sum to the budget exactly, funded once by the DAO, paid once per holder, retry-safe.",
    methods: ["prepare_distribution", "pay_recipient"], status: "Live" },
  { tone: "gold", title: "Exit", text: "A preference waterfall paid as an explicit payout list, accelerated vesting, then a final, closed ledger.",
    methods: ["prepare_explicit_distribution", "close_company"], status: "Live · close in Sandbox" },
] as const;

export default function Home() {
  const configured = process.env.NEXT_PUBLIC_COMPANY_CONTRACT_ID;
  return <main className="home">
    <section className="hero" aria-labelledby="home-title">
      <HornLogo size={168} animated />
      <div>
        <p className="eyebrow">DAO-governed ownership on NEAR</p>
        <h1 id="home-title">Captab</h1>
        <p className="tagline">From day zero <em className="iridescent">to unicorn.</em></p>
        <p className="intro">A company contract keeps the cap table; a Sputnik DAO board approves every change. Found, hire, raise, trade, pay out, and exit on one ledger.</p>
        <div className="hero-actions">
          {configured ? <Link className="button" href={`/company/${configured}`}>Open company</Link>
            : <p>Set <code>NEXT_PUBLIC_COMPANY_CONTRACT_ID</code> to a deployed company account to view its live ledger.</p>}
          <Link className="button ghost" href="/setup">Inspect or deploy a company</Link>
        </div>
        <span className="disclaimer">Testnet prototype · units are ledger records, not legal shares</span>
      </div>
    </section>
    <section aria-labelledby="journey-title">
      <h2 id="journey-title">The journey</h2>
      <ol className="journey">
        {STAGES.map((stage, index) => <li key={stage.title} data-tone={stage.tone}>
          <div className="stage-head"><span className="stage-num">{index + 1}</span><h3>{stage.title}</h3></div>
          <p>{stage.text}</p>
          <div className="methods">{stage.methods.map(method => <code key={method}>{method}</code>)}</div>
          <Pill status={stage.status} tone="good" />
        </li>)}
      </ol>
      <p className="journey-note">“v2” stages need a company on contract schema 2; the app reads v1 and v2 companies side by side. An IPO itself happens off-chain:
        Captab hands the transfer agent or acquirer a verifiable cap table export, pays the proceeds, and closes the ledger.</p>
    </section>
  </main>;
}
