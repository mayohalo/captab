"use client";

import { type NearWalletBase } from "@hot-labs/near-connect";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type CompanyConfig, type DaoPolicy, type DaoProposal, type Deal, type Distribution, type Grant, type Round, type Totals } from "../lib/near";
import type { PreparedProposal, ProposalAction, ProposalRequest } from "../lib/proposal-builder";
import { observeTransaction } from "../lib/observe";
import { describeObservation } from "../lib/observed-status.mjs";
import { getConnector } from "./wallet";
import { councilMembers, councilRule, describeRule } from "../lib/dao-policy";

type PreparedEnvelope = { proposal: PreparedProposal; daoId: string; proposalBond: string; expectedRevision: number; preparedAt: string };

function readableAction(prepared: PreparedProposal) {
  const call = prepared.kind.FunctionCall as { receiver_id: string; actions: { method_name: string; args: string; gas: string; deposit: string }[] };
  const action = call.actions[0];
  const bytes = Uint8Array.from(atob(action.args), character => character.charCodeAt(0));
  return { receiver_id: call.receiver_id, method_name: action.method_name, args: JSON.parse(new TextDecoder().decode(bytes)), gas: action.gas, deposit: action.deposit };
}

function assertTransactionSucceeded(status: unknown) {
  if (status === "Failure" || (typeof status === "object" && status !== null && "Failure" in status)) {
    throw new Error(`Transaction failed: ${JSON.stringify(status)}`);
  }
}

type V2Fields = { docHash: string; scheduleMonths: string; cliffMonths: string; source: "pool" | "unallocated"; months: string;
  account: string; toAccount: string; authorizedUnits: string; roundId: string; pricePerUnit: string; dealKind: "Issue" | "Secondary" | "Buyback";
  seller: string; buyer: string; price: string; expiresInDays: string; dealId: string; payoutsText: string; label: string };

/** Parses "account amount" lines (base units) into payout rows; blank lines are ignored. */
export function parsePayouts(text: string) {
  return text.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const [account_id, amount, ...rest] = line.split(/[\s,]+/);
    if (!account_id || !amount || rest.length) throw new Error(`Payout lines are "account amount": ${line}`);
    return { account_id, amount };
  });
}

export function GovernancePanel({ id, totals, config, policy, governanceVerified, proposals, grants, distributions, deals = [], rounds = [], initialAction = "founder" }: {
  id: string; totals: Totals; config: CompanyConfig; policy: DaoPolicy | null;
  governanceVerified: boolean; initialAction?: ProposalAction;
  proposals: DaoProposal[]; grants: Grant[]; distributions: Distribution[]; deals?: Deal[]; rounds?: Round[];
}) {
  const v2 = config.schema_version === 2;
  const openRound = rounds.find(round => round.closed_at === null);
  const [fields, setFields] = useState<V2Fields>({ docHash: "", scheduleMonths: "48", cliffMonths: "12", source: "pool", months: "12",
    account: "", toAccount: "", authorizedUnits: "", roundId: openRound?.id ?? "", pricePerUnit: "", dealKind: "Issue",
    seller: "", buyer: "", price: "", expiresInDays: "14", dealId: String(deals.find(deal => deal.status === "Approved" || deal.status === "Accepted")?.id ?? ""),
    payoutsText: "", label: "" });
  const router = useRouter();
  const [wallet, setWallet] = useState<NearWalletBase | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [action, setAction] = useState<ProposalAction>(initialAction);
  const [recipient, setRecipient] = useState("");
  const [units, setUnits] = useState("");
  const [startIso, setStartIso] = useState("");
  const [grantId, setGrantId] = useState(String(grants.find(grant => grant.cancelled_at === null)?.id ?? ""));
  const [distributionId, setDistributionId] = useState(String(distributions[0]?.id ?? ""));
  const [prepared, setPrepared] = useState<PreparedEnvelope | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = distributions.find(d => String(d.id) === distributionId);
  const council = councilMembers(policy);
  const rule = councilRule(policy);
  const isCouncil = Boolean(governanceVerified && account && council.includes(account));

  useEffect(() => {
    let active = true;
    getConnector().getConnectedWallet().then(({ wallet, accounts }) => {
      if (active) { setWallet(wallet); setAccount(accounts[0]?.accountId ?? null); }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function connect() {
    try {
      const selectedWallet = await getConnector().connect();
      const accounts = await selectedWallet.getAccounts();
      setWallet(selectedWallet);
      setAccount(accounts[0]?.accountId ?? null);
      setStatus("");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Wallet connection failed"); }
  }

  async function prepare() {
    setBusy(true);
    setPrepared(null);
    setStatus("Checking current chain state…");
    try {
      if (!policy) throw new Error("DAO policy is unavailable; proposal bond cannot be verified.");
      if (!governanceVerified) throw new Error("Company code or DAO policy is not verified.");
      const input: ProposalRequest = { action, expectedRevision: totals.ledger_revision,
        recipient, units, startIso, grantId: Number(grantId), distributionId: Number(distributionId) };
      if (v2) Object.assign(input, {
        ...(fields.docHash.trim() ? { docHash: fields.docHash.trim().toLowerCase() } : {}),
        ...(action === "grant" ? { scheduleMonths: Number(fields.scheduleMonths), cliffMonths: Number(fields.cliffMonths), source: fields.source } : {}),
        months: Number(fields.months), account: fields.account, toAccount: fields.toAccount, authorizedUnits: fields.authorizedUnits,
        roundId: fields.roundId || undefined, pricePerUnit: fields.pricePerUnit, dealKind: fields.dealKind, seller: fields.seller,
        buyer: fields.buyer, price: fields.price, expiresInDays: Number(fields.expiresInDays), dealId: Number(fields.dealId),
        ...(action === "explicitDistribution" ? { payouts: parsePayouts(fields.payoutsText), ...(fields.label.trim() ? { label: fields.label.trim() } : {}) } : {}),
      });
      const response = await fetch(`/api/companies/${id}/proposals`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json() as PreparedEnvelope & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Proposal could not be prepared");
      setPrepared(result);
      setStatus("");
    } catch (error) { setPrepared(null); setStatus(error instanceof Error ? error.message : "Unable to prepare proposal"); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!prepared || !wallet || !policy || !account) return;
    setBusy(true);
    setStatus("Awaiting wallet signature…");
    try {
      const outcome = await wallet.signAndSendTransaction({
        receiverId: prepared.daoId,
        actions: [{ type: "FunctionCall", params: {
          methodName: "add_proposal", args: { proposal: prepared.proposal }, gas: "120000000000000", deposit: prepared.proposalBond,
        } }],
      });
      assertTransactionSucceeded(outcome.status);
      setStatus(`Submitted proposal ${outcome.transaction.hash}. Waiting for receipt observation…`);
      const observed = await observeTransaction(id, account, outcome.transaction.hash);
      setStatus(`Proposal submitted: ${outcome.transaction.hash}. ${describeObservation(observed)} Board votes and company execution remain separate.`);
      setPrepared(null);
      router.refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Proposal submission failed"); }
    finally { setBusy(false); }
  }

  async function approve(proposal: DaoProposal) {
    if (!wallet || !isCouncil || !account) return;
    setBusy(true);
    setStatus(`Awaiting signature for proposal #${proposal.id}…`);
    try {
      const outcome = await wallet.signAndSendTransaction({
        receiverId: config.dao_id,
        actions: [{ type: "FunctionCall", params: {
          methodName: "act_proposal",
          args: { id: proposal.id, action: "VoteApprove", proposal: proposal.kind },
          gas: "300000000000000", deposit: "0",
        } }],
      });
      assertTransactionSucceeded(outcome.status);
      setStatus(`Submitted vote ${outcome.transaction.hash}. Waiting for receipt observation…`);
      const observed = await observeTransaction(id, account, outcome.transaction.hash);
      setStatus(`Vote transaction ${outcome.transaction.hash}. ${describeObservation(observed)} Verify the DAO and company outcome separately.`);
      router.refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Vote failed"); }
    finally { setBusy(false); }
  }

  return <section id="governance">
    <h2>Governance</h2>
    <p>Sputnik DAO {config.dao_id}. A proposal needs {describeRule(rule)} council approvals under the DAO policy. The company changes only after the DAO executes the call.</p>
    {!policy || !governanceVerified ? <p role="alert">Company code and a majority council policy on the pinned Sputnik build must be verified before proposal submission.</p> : <>
      <p>Proposal bond: {policy.proposal_bond} yoctoNEAR · {account ? `${account}${isCouncil ? " (council)" : ""}` : "Wallet disconnected"}</p>
      {!account && <button onClick={connect}>Connect to propose or vote</button>}
      <div className="governance-form">
        <label>Action<select disabled={busy} value={action} onChange={event => { setAction(event.target.value as ProposalAction); setPrepared(null); }}>
          <option value="founder">Issue founder units</option><option value="pool">Increase contributor pool</option>
          <option value="grant">Create contributor grant</option><option value="cancelGrant">Cancel unvested grant</option>
          <option value="approve">Approve distribution</option><option value="fund">Fund approved distribution</option>
          <option value="cancelDistribution">Cancel unfunded distribution</option>
          {config.paused ? <option value="resume">Resume company</option> : <option value="pause">Pause company</option>}
          {v2 && <optgroup label="Capital and ledger (schema v2)">
            <option value="createRound">Open an investor round</option><option value="closeRound">Close a round</option>
            <option value="approveDeal">Approve a deal: issuance, secondary sale, or buyback</option>
            <option value="payBuyback">Pay for an accepted buyback</option><option value="cancelDeal">Cancel a deal</option>
            <option value="explicitDistribution">Explicit payout list (exit or waterfall)</option>
            <option value="increaseAuthorized">Raise authorized units</option><option value="decreasePool">Shrink the contributor pool</option>
            <option value="accelerateGrant">Accelerate a grant</option><option value="retire">Retire units</option>
            <option value="reassign">Move a holding to a new wallet</option><option value="closeCompany">Close the company</option>
          </optgroup>}
        </select></label>
        {(action === "founder" || action === "pool") && <>
          {action === "founder" && <label>Recipient account<input disabled={busy} value={recipient} onChange={event => { setRecipient(event.target.value.trim()); setPrepared(null); }} placeholder="founder.testnet" /></label>}
          <label>Units<input disabled={busy} inputMode="numeric" value={units} onChange={event => { setUnits(event.target.value.trim()); setPrepared(null); }} placeholder="1000" /></label>
          <p>Unallocated: {totals.unallocated_units} · expected revision: {totals.ledger_revision}</p>
        </>}
        {action === "grant" && <>
          <label>Recipient account<input disabled={busy} value={recipient} onChange={event => { setRecipient(event.target.value.trim()); setPrepared(null); }} placeholder="contributor.testnet" /></label>
          <label>Grant units<input disabled={busy} inputMode="numeric" value={units} onChange={event => { setUnits(event.target.value.trim()); setPrepared(null); }} placeholder="1000" /></label>
          <label>UTC start (ISO 8601)<input disabled={busy} value={startIso} onChange={event => { setStartIso(event.target.value.trim()); setPrepared(null); }} placeholder="2026-11-01T00:00:00Z" /></label>
          <p>Available pool: {totals.pool_available} · 12-month cliff · 48 monthly boundaries. Historical starts are allowed for demo fixtures.</p>
        </>}
        {v2 && <V2Inputs action={action} fields={fields} busy={busy} rounds={rounds} deals={deals} grants={grants}
          onChange={change => { setFields(current => ({ ...current, ...change })); setPrepared(null); }}
          units={units} setUnits={value => { setUnits(value); setPrepared(null); }} />}
        {(action === "cancelGrant" || action === "accelerateGrant") && <label>Active grant<select disabled={busy} value={grantId} onChange={event => { setGrantId(event.target.value); setPrepared(null); }}>
          {grants.filter(grant => grant.cancelled_at === null).map(grant => <option key={grant.id} value={grant.id}>#{grant.id} · {grant.recipient} · {grant.original_units} units</option>)}
        </select></label>}
        {(action === "approve" || action === "fund" || action === "cancelDistribution") && <label>Distribution<select disabled={busy} value={distributionId} onChange={event => { setDistributionId(event.target.value); setPrepared(null); }}>
          {distributions.map(d => <option key={d.id} value={d.id}>#{d.id} · {d.approved ? "approved" : "pending"} · {d.funded ? "funded" : "unfunded"}</option>)}
        </select></label>}
        {selected && (action === "approve" || action === "fund" || action === "cancelDistribution") && <p>Budget {selected.budget} · token {selected.token_id} · expires {new Date(selected.expires_at * 1000).toUTCString()}</p>}
        <button onClick={() => void prepare()} disabled={busy || (config.paused && !["resume", "cancelDistribution", "cancelDeal", "closeRound", "closeCompany"].includes(action))}>Review proposal</button>
      </div>
      {prepared && <article><h3>Review exact DAO action</h3><p>{prepared.proposal.description}</p><pre>{JSON.stringify(readableAction(prepared.proposal), null, 2)}</pre><p>Prepared from on-chain revision {prepared.expectedRevision} at {prepared.preparedAt}. This proposal is immutable; prepare a new one if chain state changes.</p><button onClick={submit} disabled={busy || !wallet || !account}>Submit to DAO</button></article>}
    </>}
    {status && <p role="status">{status}</p>}
    <h3>Recent proposals</h3>
    {proposals.length === 0 ? <p>No recent proposals or DAO history unavailable.</p> : <div className="cards">{[...proposals].reverse().map(proposal => <article key={proposal.id}>
      <h3>#{proposal.id} · {proposal.status}</h3><p>{proposal.description}</p><p>Proposed by {proposal.proposer}</p>
      {proposal.status === "Failed" && <p role="alert">DAO execution failed. Review the receipt before creating a replacement proposal.</p>}
      {proposal.status === "InProgress" && isCouncil && <button disabled={busy} onClick={() => approve(proposal)}>Vote to approve</button>}
      <details><summary>Exact proposal kind</summary><pre>{JSON.stringify(proposal.kind, null, 2)}</pre></details>
    </article>)}</div>}
  </section>;
}

function V2Inputs({ action, fields, busy, rounds, deals, onChange, units, setUnits }: {
  action: ProposalAction; fields: V2Fields; busy: boolean; rounds: Round[]; deals: Deal[]; grants: Grant[];
  onChange: (change: Partial<V2Fields>) => void; units: string; setUnits: (value: string) => void;
}) {
  const text = (label: string, key: keyof V2Fields, placeholder = "") => <label>{label}<input disabled={busy} value={fields[key]}
    onChange={event => onChange({ [key]: event.target.value.trim() } as Partial<V2Fields>)} placeholder={placeholder} /></label>;
  const openDeals = deals.filter(deal => deal.status === "Approved" || deal.status === "Accepted");
  const documentField = action !== "closeRound" && action !== "cancelDeal" && action !== "payBuyback" && action !== "pause" &&
    action !== "resume" && action !== "approve" && action !== "fund" && action !== "cancelDistribution";
  return <>
    {action === "grant" && <>
      <label>Schedule length (months)<input disabled={busy} inputMode="numeric" value={fields.scheduleMonths} onChange={event => onChange({ scheduleMonths: event.target.value.trim() })} /></label>
      <label>Cliff (months, 0 for none)<input disabled={busy} inputMode="numeric" value={fields.cliffMonths} onChange={event => onChange({ cliffMonths: event.target.value.trim() })} /></label>
      <label>Reserve units from<select disabled={busy} value={fields.source} onChange={event => onChange({ source: event.target.value as V2Fields["source"] })}>
        <option value="pool">Contributor pool</option><option value="unallocated">Unallocated capacity (founder vesting)</option>
      </select></label>
    </>}
    {action === "increaseAuthorized" && text("New authorized total (units)", "authorizedUnits")}
    {(action === "decreasePool" || action === "retire" || action === "approveDeal") &&
      <label>Units<input disabled={busy} inputMode="numeric" value={units} onChange={event => setUnits(event.target.value.trim())} /></label>}
    {action === "retire" && text("Holder account", "account", "holder.testnet")}
    {action === "reassign" && <>{text("Old wallet", "account", "lost.testnet")}{text("New wallet", "toAccount", "new.testnet")}</>}
    {action === "accelerateGrant" && text("Extra months to count as vested", "months")}
    {action === "createRound" && <>{text("Round ID", "roundId", "seed")}{text("Price per unit (token base units)", "pricePerUnit", "1000000")}</>}
    {(action === "closeRound" || (action === "approveDeal" && fields.dealKind === "Issue")) && <label>Round<select disabled={busy} value={fields.roundId}
      onChange={event => onChange({ roundId: event.target.value })}>
      <option value="">Select a round</option>
      {rounds.filter(round => round.closed_at === null).map(round => <option key={round.id} value={round.id}>{round.id} · {round.price_per_unit} per unit</option>)}
    </select></label>}
    {action === "approveDeal" && <>
      <label>Deal type<select disabled={busy} value={fields.dealKind} onChange={event => onChange({ dealKind: event.target.value as V2Fields["dealKind"] })}>
        <option value="Issue">Issue new units to an investor</option><option value="Secondary">Secondary sale between holders</option>
        <option value="Buyback">Company buyback (the DAO pays)</option>
      </select></label>
      {fields.dealKind !== "Issue" && text("Seller (current holder)", "seller", "founder.testnet")}
      {fields.dealKind !== "Buyback" && text(fields.dealKind === "Issue" ? "Investor account" : "Buyer account", "buyer", "investor.testnet")}
      {fields.dealKind === "Issue"
        ? <p>Price is units × the round&apos;s price per unit. The investor pays it with the settlement token; the money goes to the DAO.</p>
        : text("Total price (token base units)", "price")}
      {text("Expires in (days)", "expiresInDays")}
      <p>{fields.dealKind === "Issue" ? "Units are reserved now and issued when the investor pays." : "The seller must accept on the Deals page before the deal can be paid."}</p>
    </>}
    {(action === "cancelDeal" || action === "payBuyback") && <label>Deal<select disabled={busy} value={fields.dealId} onChange={event => onChange({ dealId: event.target.value })}>
      {openDeals.filter(deal => action === "cancelDeal" || (deal.kind === "Buyback" && deal.status === "Accepted"))
        .map(deal => <option key={deal.id} value={deal.id}>#{deal.id} · {deal.kind} · {deal.units} units · {deal.status}</option>)}
    </select></label>}
    {action === "explicitDistribution" && <>
      <label>Payouts, one &quot;account amount&quot; per line (token base units)<textarea disabled={busy} rows={6} value={fields.payoutsText}
        onChange={event => onChange({ payoutsText: event.target.value })} placeholder={"founder.testnet 400000\ninvestor.testnet 600000"} /></label>
      {text("Label", "label", "exit")}{text("Expires in (days)", "expiresInDays")}
      <p>Recipients must be holders or grant recipients, and the amounts set the budget. The exit preview can produce these lines.</p>
    </>}
    {action === "closeCompany" && <p role="alert">Closing is permanent. Every distribution must be paid or cancelled and every deal settled or cancelled first.</p>}
    {documentField && text("Document SHA-256 (optional)", "docHash", "64 hex characters")}
  </>;
}
