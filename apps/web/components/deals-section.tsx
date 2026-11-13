"use client";

import { type NearWalletBase } from "@hot-labs/near-connect";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatUnits, type CompanyConfig, type Deal, type Round } from "../lib/near";
import { observeTransaction } from "../lib/observe";
import { describeObservation } from "../lib/observed-status.mjs";
import { getConnector } from "./wallet";
import { Pill } from "./brand";

type Action = "accept" | "withdraw" | "pay" | "forward" | "expire";

function failed(status: unknown) {
  return status === "Failure" || (typeof status === "object" && status !== null && "Failure" in status);
}

/** Who may do what with a deal right now, from the contract's rules. */
export function dealActions(deal: Deal, account: string | null, nowSeconds: number): Action[] {
  const open = deal.status === "Approved" || deal.status === "Accepted";
  const expired = nowSeconds >= deal.expires_at;
  const actions: Action[] = [];
  if (!account) return deal.status === "Settled" && deal.proceeds_pending !== "0" && !deal.forward_in_flight ? ["forward"] : [];
  if (deal.kind !== "Issue" && deal.status === "Approved" && !expired && account === deal.seller) actions.push("accept");
  if (open && account === deal.seller) actions.push("withdraw");
  const payable = deal.kind === "Issue" ? deal.status === "Approved" : deal.kind === "Secondary" && deal.status === "Accepted";
  if (payable && !expired && account === deal.buyer) actions.push("pay");
  if (deal.status === "Settled" && deal.proceeds_pending !== "0" && !deal.forward_in_flight) actions.push("forward");
  if (open && expired && account !== deal.seller) actions.push("expire");
  return actions;
}

const labels: Record<Action, string> = {
  accept: "Accept and lock my units", withdraw: "Withdraw from this deal", pay: "Pay with the settlement token",
  forward: "Retry delivering the payment", expire: "Clean up expired deal",
};

export function DealsSection({ id, config, deals, rounds, companyVerified }: {
  id: string; config: CompanyConfig; deals: Deal[]; rounds: Round[]; companyVerified: boolean;
}) {
  const router = useRouter();
  const [wallet, setWallet] = useState<NearWalletBase | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    let active = true;
    getConnector().getConnectedWallet().then(({ wallet, accounts }) => {
      if (active) { setWallet(wallet); setAccount(accounts[0]?.accountId ?? null); }
    }).catch(() => {});
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  if (config.schema_version !== 2) {
    return <section id="deals"><h2>Rounds and deals</h2>
      <p>This company runs contract schema v{config.schema_version}. Investor rounds, secondary sales, and buybacks need schema v2.</p></section>;
  }

  async function connect() {
    try {
      const selected = await getConnector().connect();
      const accounts = await selected.getAccounts();
      setWallet(selected); setAccount(accounts[0]?.accountId ?? null);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Wallet connection failed"); }
  }

  async function run(deal: Deal, action: Action) {
    if (!wallet || !account || !companyVerified) return;
    setBusy(true);
    setStatus(`Awaiting wallet signature: ${labels[action].toLowerCase()} (deal #${deal.id})…`);
    try {
      const request = action === "pay"
        ? { receiverId: config.settlement_token_id, actions: [{ type: "FunctionCall" as const, params: { methodName: "ft_transfer_call",
          args: { receiver_id: id, amount: deal.price, msg: JSON.stringify({ deal_id: deal.id }) }, gas: "150000000000000", deposit: "1" } }] }
        : { receiverId: id, actions: [{ type: "FunctionCall" as const, params: {
          methodName: action === "accept" ? "accept_deal" : action === "forward" ? "forward_proceeds" : "cancel_deal",
          args: { deal_id: deal.id }, gas: action === "forward" ? "60000000000000" : "30000000000000", deposit: "0" } }] };
      const outcome = await wallet.signAndSendTransaction(request);
      if (failed(outcome.status)) throw new Error(`Transaction failed: ${JSON.stringify(outcome.status)}`);
      if (action === "pay") {
        // The payment goes to the token contract, which the observation service does not track; the deal view is the source of truth.
        setStatus(`Payment ${outcome.transaction.hash} sent. A wrong amount, payer, or expired deal is refunded by the token; refresh to see the deal settle.`);
      } else {
        const observed = await observeTransaction(id, account, outcome.transaction.hash);
        setStatus(`${labels[action]}: ${outcome.transaction.hash}. ${describeObservation(observed)}`);
      }
      router.refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Transaction failed"); }
    finally { setBusy(false); }
  }

  return <section id="deals">
    <h2>Rounds and deals</h2>
    <p>Every deal is approved by the board first. Investors pay for new units in the same transaction that issues them, and the money goes to the DAO.
      In a secondary sale or buyback the seller signs to lock their units, then the buyer (or the DAO) pays and the seller is paid.</p>
    <div className="wallet">{account ? <span>{account}</span> : <button onClick={connect}>Connect wallet</button>}</div>
    {!companyVerified && <p role="alert">Company code is not verified, so deal transactions are disabled.</p>}
    <h3>Rounds</h3>
    {rounds.length === 0 ? <p>No rounds yet. The board opens one from Approvals.</p> :
      <div className="table-scroll" role="region" aria-label="Rounds table" tabIndex={0}><table>
        <thead><tr><th>Round</th><th>Price per unit</th><th>Units issued</th><th>Raised</th><th>Status</th></tr></thead>
        <tbody>{rounds.map(round => <tr key={round.id}><td>{round.id}</td><td>{formatUnits(round.price_per_unit)}</td><td>{formatUnits(round.units_issued)}</td>
          <td>{formatUnits(round.amount_raised)}</td><td><Pill status={round.closed_at ? "Closed" : "Open"} /></td></tr>)}</tbody>
      </table></div>}
    <h3>Deals</h3>
    {deals.length === 0 ? <p>No deals yet.</p> : <div className="cards">{deals.map(deal => {
      const actions = dealActions(deal, account, now);
      return <article key={deal.id} data-testid={`deal-${deal.id}`}>
        <h3>#{deal.id} · {deal.kind === "Issue" ? `Issuance${deal.round_id ? ` in ${deal.round_id}` : ""}` : deal.kind === "Secondary" ? "Secondary sale" : "Buyback"} · <Pill status={deal.status} /></h3>
        <p>{formatUnits(deal.units)} units for {formatUnits(deal.price)} token base units · {deal.seller ? `seller ${deal.seller}` : "issued by the company"} → {deal.buyer ?? "company (DAO pays)"}</p>
        <p>Expires {new Date(deal.expires_at * 1000).toUTCString()}{deal.doc_hash ? ` · document ${deal.doc_hash.slice(0, 12)}…` : ""}</p>
        {deal.status === "Settled" && <p>Payment to {deal.proceeds_recipient}: {deal.proceeds_pending === "0" ? "delivered"
          : deal.forward_in_flight ? "in flight" : `${formatUnits(deal.proceeds_pending)} held; anyone can retry once the recipient is registered with the token`}</p>}
        {deal.kind === "Buyback" && deal.status === "Accepted" && <p>Accepted. The board pays it with a &quot;Pay for an accepted buyback&quot; proposal.</p>}
        {actions.map(action => <button key={action} disabled={busy || !companyVerified || !wallet}
          onClick={() => void run(deal, action)}>{labels[action]}</button>)}
      </article>;
    })}</div>}
    {status && <p role="status">{status}</p>}
  </section>;
}
