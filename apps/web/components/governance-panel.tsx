"use client";

import { type NearWalletBase } from "@hot-labs/near-connect";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type CompanyConfig, type DaoPolicy, type DaoProposal, type Distribution, type Grant, type Totals } from "../lib/near";
import type { PreparedProposal, ProposalAction, ProposalRequest } from "../lib/proposal-builder";
import { observeTransaction } from "../lib/observe";
import { getConnector } from "./wallet";

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

export function GovernancePanel({ id, totals, config, policy, daoVerified, proposals, grants, distributions, initialAction = "founder" }: {
  id: string; totals: Totals; config: CompanyConfig; policy: DaoPolicy | null;
  daoVerified: boolean; initialAction?: ProposalAction;
  proposals: DaoProposal[]; grants: Grant[]; distributions: Distribution[];
}) {
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
  const council = policy?.roles.find(role => role.name === "council")?.kind.Group ?? [];
  const isCouncil = Boolean(daoVerified && account && council.includes(account));

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
      if (!daoVerified) throw new Error("DAO code or two-of-three policy is not verified.");
      const input: ProposalRequest = { action, expectedRevision: totals.ledger_revision,
        recipient, units, startIso, grantId: Number(grantId), distributionId: Number(distributionId) };
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
      const observed = await observeTransaction(id, account, outcome.transaction.hash);
      setStatus(`Proposal submitted: ${outcome.transaction.hash}. It still needs board votes and successful execution.${observed ? ` History: ${observed.status}.` : " History sync unavailable; keep this hash."}`);
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
      const observed = await observeTransaction(id, account, outcome.transaction.hash);
      setStatus(`Vote transaction ${outcome.transaction.hash}. Refresh to verify the DAO and company outcome.${observed ? ` History: ${observed.status}.` : " History sync unavailable; keep this hash."}`);
      router.refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Vote failed"); }
    finally { setBusy(false); }
  }

  return <section id="governance">
    <h2>Governance</h2>
    <p>Sputnik DAO {config.dao_id}. A proposal needs two council approvals under the configured demo policy. The company changes only after the DAO executes the call.</p>
    {!policy || !daoVerified ? <p role="alert">DAO code and two-of-three policy must be verified before proposal submission.</p> : <>
      <p>Proposal bond: {policy.proposal_bond} yoctoNEAR · {account ? `${account}${isCouncil ? " (council)" : ""}` : "Wallet disconnected"}</p>
      {!account && <button onClick={connect}>Connect to propose or vote</button>}
      <div className="governance-form">
        <label>Action<select disabled={busy} value={action} onChange={event => { setAction(event.target.value as ProposalAction); setPrepared(null); }}>
          <option value="founder">Issue founder units</option><option value="pool">Increase contributor pool</option>
          <option value="grant">Create contributor grant</option><option value="cancelGrant">Cancel unvested grant</option>
          <option value="approve">Approve distribution</option><option value="fund">Fund approved distribution</option>
          <option value="cancelDistribution">Cancel unfunded distribution</option>
          {config.paused ? <option value="resume">Resume company</option> : <option value="pause">Pause company</option>}
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
        {action === "cancelGrant" && <label>Active grant<select disabled={busy} value={grantId} onChange={event => { setGrantId(event.target.value); setPrepared(null); }}>
          {grants.filter(grant => grant.cancelled_at === null).map(grant => <option key={grant.id} value={grant.id}>#{grant.id} · {grant.recipient} · {grant.original_units} units</option>)}
        </select></label>}
        {(action === "approve" || action === "fund" || action === "cancelDistribution") && <label>Distribution<select disabled={busy} value={distributionId} onChange={event => { setDistributionId(event.target.value); setPrepared(null); }}>
          {distributions.map(d => <option key={d.id} value={d.id}>#{d.id} · {d.approved ? "approved" : "pending"} · {d.funded ? "funded" : "unfunded"}</option>)}
        </select></label>}
        {selected && (action === "approve" || action === "fund" || action === "cancelDistribution") && <p>Budget {selected.budget} · token {selected.token_id} · expires {new Date(selected.expires_at * 1000).toUTCString()}</p>}
        <button onClick={() => void prepare()} disabled={busy || (config.paused && action !== "resume" && action !== "cancelDistribution")}>Review proposal</button>
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
