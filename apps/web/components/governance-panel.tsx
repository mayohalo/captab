"use client";

import { type NearWalletBase } from "@hot-labs/near-connect";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type CompanyConfig, type DaoPolicy, type DaoProposal, type Distribution, type Grant, type Totals, validAccountId } from "../lib/near";
import { buildMonthlyBoundaries } from "../lib/vesting";
import { observeTransaction } from "../lib/observe";
import { getConnector } from "./wallet";

type Action = "founder" | "pool" | "grant" | "cancelGrant" | "approve" | "fund";
type Prepared = { description: string; kind: Record<string, unknown> };

function base64Json(value: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes));
}

function functionCall(receiverId: string, methodName: string, args: Record<string, unknown>, gas: string, deposit: string) {
  return { FunctionCall: { receiver_id: receiverId, actions: [{ method_name: methodName, args: base64Json(args), gas, deposit }] } };
}

function readableAction(prepared: Prepared) {
  const call = prepared.kind.FunctionCall as { receiver_id: string; actions: { method_name: string; args: string; gas: string; deposit: string }[] };
  const action = call.actions[0];
  const bytes = Uint8Array.from(atob(action.args), character => character.charCodeAt(0));
  return { receiver_id: call.receiver_id, method_name: action.method_name, args: JSON.parse(new TextDecoder().decode(bytes)), gas: action.gas, deposit: action.deposit };
}

function positiveInteger(value: string): boolean { return /^[1-9]\d*$/.test(value); }

function assertTransactionSucceeded(status: unknown) {
  if (status === "Failure" || (typeof status === "object" && status !== null && "Failure" in status)) {
    throw new Error(`Transaction failed: ${JSON.stringify(status)}`);
  }
}

export function GovernancePanel({ id, totals, config, policy, proposals, grants, distributions }: {
  id: string; totals: Totals; config: CompanyConfig; policy: DaoPolicy | null;
  proposals: DaoProposal[]; grants: Grant[]; distributions: Distribution[];
}) {
  const router = useRouter();
  const [wallet, setWallet] = useState<NearWalletBase | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [action, setAction] = useState<Action>("founder");
  const [recipient, setRecipient] = useState("");
  const [units, setUnits] = useState("");
  const [startIso, setStartIso] = useState("");
  const [grantId, setGrantId] = useState(String(grants.find(grant => grant.cancelled_at === null)?.id ?? ""));
  const [distributionId, setDistributionId] = useState(String(distributions[0]?.id ?? ""));
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = distributions.find(d => String(d.id) === distributionId);
  const selectedGrant = grants.find(grant => String(grant.id) === grantId);
  const council = policy?.roles.find(role => role.name === "council")?.kind.Group ?? [];
  const isCouncil = Boolean(account && council.includes(account));

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

  function prepare() {
    try {
      if (!policy) throw new Error("DAO policy is unavailable; proposal bond cannot be verified.");
      if (config.paused) throw new Error("Company is paused.");
      let next: Prepared;
      const actionId = crypto.randomUUID();
      if (action === "founder" || action === "pool") {
        if (!positiveInteger(units)) throw new Error("Enter a positive whole number of units.");
        if (BigInt(units) > BigInt(totals.unallocated_units)) throw new Error("Units exceed unallocated capacity.");
        if (action === "founder") {
          if (!validAccountId(recipient)) throw new Error("Enter a valid NEAR recipient account.");
          next = {
            description: `Issue ${units} founder units to ${recipient} (revision ${totals.ledger_revision})`,
            kind: functionCall(id, "issue_founder_units", { action_id: actionId, expected_revision: totals.ledger_revision, recipient, units }, "40000000000000", "0"),
          };
        } else {
          next = {
            description: `Reserve ${units} contributor pool units (revision ${totals.ledger_revision})`,
            kind: functionCall(id, "increase_pool", { action_id: actionId, expected_revision: totals.ledger_revision, units }, "40000000000000", "0"),
          };
        }
      } else if (action === "grant") {
        if (!positiveInteger(units)) throw new Error("Enter a positive whole number of units.");
        if (BigInt(units) > BigInt(totals.pool_available)) throw new Error("Units exceed the available contributor pool.");
        if (!validAccountId(recipient)) throw new Error("Enter a valid NEAR recipient account.");
        const boundaries = buildMonthlyBoundaries(startIso);
        next = {
          description: `Grant ${units} units to ${recipient}; cliff ${new Date(boundaries[12] * 1000).toISOString()} (revision ${totals.ledger_revision})`,
          kind: functionCall(id, "create_grant", { action_id: actionId, expected_revision: totals.ledger_revision, recipient, units, boundaries }, "80000000000000", "0"),
        };
      } else if (action === "cancelGrant") {
        if (!selectedGrant || selectedGrant.cancelled_at !== null) throw new Error("Select an active grant.");
        next = {
          description: `Cancel unvested units in grant #${selectedGrant.id} for ${selectedGrant.recipient}`,
          kind: functionCall(id, "cancel_unvested", { action_id: actionId, grant_id: selectedGrant.id }, "40000000000000", "0"),
        };
      } else {
        if (!selected) throw new Error("Select a distribution.");
        if (selected.cancelled || selected.funded) throw new Error("Distribution is closed.");
        if (selected.expires_at <= Math.floor(Date.now() / 1000)) throw new Error("Distribution has expired.");
        if (action === "approve") {
          if (selected.approved) throw new Error("Distribution is already approved.");
          next = {
            description: `Approve distribution #${selected.id} schedule hash`,
            kind: functionCall(id, "approve_distribution", { action_id: actionId, distribution_id: selected.id, schedule_hash: selected.schedule_hash }, "40000000000000", "0"),
          };
        } else {
          if (!selected.approved) throw new Error("Approve the schedule before funding.");
          next = {
            description: `Fund distribution #${selected.id} with ${selected.budget} token base units`,
            kind: functionCall(selected.token_id, "ft_transfer_call", {
              receiver_id: id,
              amount: selected.budget,
              msg: JSON.stringify({ distribution_id: selected.id, schedule_hash: selected.schedule_hash }),
            }, "120000000000000", "1"),
          };
        }
      }
      setPrepared(next);
      setStatus("");
    } catch (error) { setPrepared(null); setStatus(error instanceof Error ? error.message : "Unable to prepare proposal"); }
  }

  async function submit() {
    if (!prepared || !wallet || !policy || !account) return;
    setBusy(true);
    setStatus("Awaiting wallet signature…");
    try {
      const outcome = await wallet.signAndSendTransaction({
        receiverId: config.dao_id,
        actions: [{ type: "FunctionCall", params: {
          methodName: "add_proposal", args: { proposal: prepared }, gas: "120000000000000", deposit: policy.proposal_bond,
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
    {!policy ? <p role="alert">DAO policy could not be read. Proposal submission is unavailable.</p> : <>
      <p>Proposal bond: {policy.proposal_bond} yoctoNEAR · {account ? `${account}${isCouncil ? " (council)" : ""}` : "Wallet disconnected"}</p>
      {!account && <button onClick={connect}>Connect to propose or vote</button>}
      <div className="governance-form">
        <label>Action<select value={action} onChange={event => { setAction(event.target.value as Action); setPrepared(null); }}>
          <option value="founder">Issue founder units</option><option value="pool">Increase contributor pool</option>
          <option value="grant">Create contributor grant</option><option value="cancelGrant">Cancel unvested grant</option>
          <option value="approve">Approve distribution</option><option value="fund">Fund approved distribution</option>
        </select></label>
        {(action === "founder" || action === "pool") && <>
          {action === "founder" && <label>Recipient account<input value={recipient} onChange={event => { setRecipient(event.target.value.trim()); setPrepared(null); }} placeholder="founder.testnet" /></label>}
          <label>Units<input inputMode="numeric" value={units} onChange={event => { setUnits(event.target.value.trim()); setPrepared(null); }} placeholder="1000" /></label>
          <p>Unallocated: {totals.unallocated_units} · expected revision: {totals.ledger_revision}</p>
        </>}
        {action === "grant" && <>
          <label>Recipient account<input value={recipient} onChange={event => { setRecipient(event.target.value.trim()); setPrepared(null); }} placeholder="contributor.testnet" /></label>
          <label>Grant units<input inputMode="numeric" value={units} onChange={event => { setUnits(event.target.value.trim()); setPrepared(null); }} placeholder="1000" /></label>
          <label>UTC start (ISO 8601)<input value={startIso} onChange={event => { setStartIso(event.target.value.trim()); setPrepared(null); }} placeholder="2026-11-01T00:00:00Z" /></label>
          <p>Available pool: {totals.pool_available} · 12-month cliff · 48 monthly boundaries. Historical starts are allowed for demo fixtures.</p>
        </>}
        {action === "cancelGrant" && <label>Active grant<select value={grantId} onChange={event => { setGrantId(event.target.value); setPrepared(null); }}>
          {grants.filter(grant => grant.cancelled_at === null).map(grant => <option key={grant.id} value={grant.id}>#{grant.id} · {grant.recipient} · {grant.original_units} units</option>)}
        </select></label>}
        {(action === "approve" || action === "fund") && <label>Distribution<select value={distributionId} onChange={event => { setDistributionId(event.target.value); setPrepared(null); }}>
          {distributions.map(d => <option key={d.id} value={d.id}>#{d.id} · {d.approved ? "approved" : "pending"} · {d.funded ? "funded" : "unfunded"}</option>)}
        </select></label>}
        {selected && (action === "approve" || action === "fund") && <p>Budget {selected.budget} · token {selected.token_id} · expires {new Date(selected.expires_at * 1000).toUTCString()}</p>}
        <button onClick={prepare} disabled={busy || config.paused}>Review proposal</button>
      </div>
      {prepared && <article><h3>Review exact DAO action</h3><p>{prepared.description}</p><pre>{JSON.stringify(readableAction(prepared), null, 2)}</pre><p>This proposal is immutable. If the ledger revision or distribution status changes, prepare a new one.</p><button onClick={submit} disabled={busy || !wallet || !account}>Submit to DAO</button></article>}
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
