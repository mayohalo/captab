"use client";

import { type NearWalletBase } from "@hot-labs/near-connect";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type CompanyConfig, type DaoPolicy, type Distribution, type Totals } from "../lib/near";
import { getConnector } from "./wallet";
import { observeTransaction } from "../lib/observe";

type Job = { recipient_id: string; attempt_id: number; submission_state: string; tx_hash: string | null; last_error: string | null };

export function DistributionOperator({ id, config, policy, daoVerified, totals, distributions }: {
  id: string; config: CompanyConfig; policy: DaoPolicy | null; daoVerified: boolean; totals: Totals; distributions: Distribution[];
}) {
  const router = useRouter();
  const [wallet, setWallet] = useState<NearWalletBase | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [expiry, setExpiry] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<Record<number, Job[]>>({});
  const isOperator = account === config.snapshot_operator_id;
  const isCouncil = Boolean(daoVerified && account && policy?.roles.some(role => role.name === "council" && role.kind.Group?.includes(account)));

  useEffect(() => {
    let active = true;
    getConnector().getConnectedWallet().then(({ wallet, accounts }) => {
      if (active) { setWallet(wallet); setAccount(accounts[0]?.accountId ?? null); }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function connect() {
    try {
      const selected = await getConnector().connect();
      const accounts = await selected.getAccounts();
      setWallet(selected);
      setAccount(accounts[0]?.accountId ?? null);
      setStatus("");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Wallet connection failed"); }
  }

  async function send(methodName: string, args: Record<string, unknown>, gas = "100000000000000") {
    if (!wallet || !account) return;
    setBusy(true);
    setStatus("Awaiting wallet signature…");
    try {
      const outcome = await wallet.signAndSendTransaction({
        receiverId: id,
        actions: [{ type: "FunctionCall", params: { methodName, args, gas, deposit: "0" } }],
      });
      if (outcome.status === "Failure" || (typeof outcome.status === "object" && outcome.status !== null && "Failure" in outcome.status)) {
        throw new Error(`Transaction failed: ${JSON.stringify(outcome.status)}`);
      }
      const observed = await observeTransaction(id, account, outcome.transaction.hash);
      setStatus(`Transaction ${outcome.transaction.hash}. Refresh to verify the company state and payment callback.${observed ? ` History: ${observed.status}.` : " History sync unavailable; keep this hash."}`);
      router.refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Transaction failed"); }
    finally { setBusy(false); }
  }

  function prepareSnapshot() {
    if (!/^[1-9]\d*$/.test(budget) || BigInt(budget) > 1_000_000_000_000_000_000n) {
      setStatus("Enter a positive budget in token base units, no more than 10^18.");
      return;
    }
    const expiresAt = Date.parse(expiry);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$/.test(expiry) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      setStatus("Enter a future UTC expiry, for example 2026-11-15T00:00:00Z.");
      return;
    }
    void send("prepare_distribution", {
      expected_revision: totals.ledger_revision,
      budget,
      expires_at: Math.floor(expiresAt / 1000),
    });
  }

  async function refreshJobs(distributionId: number) {
    const response = await fetch(`/api/distributions/${distributionId}/execute?companyId=${encodeURIComponent(id)}`, { cache: "no-store" });
    const result = await response.json() as { jobs?: Job[]; error?: string };
    if (!response.ok || !result.jobs) throw new Error(result.error ?? "Queue status unavailable");
    setJobs(previous => ({ ...previous, [distributionId]: result.jobs! }));
  }

  async function queue(distributionId: number) {
    setBusy(true);
    try {
      const response = await fetch(`/api/distributions/${distributionId}/execute`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: id }) });
      const result = await response.json() as { queued?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Queue request failed");
      await refreshJobs(distributionId);
      setStatus(`${result.queued ?? 0} entitlement(s) queued for distribution #${distributionId}. The worker submits one at a time.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Queue request failed"); }
    finally { setBusy(false); }
  }

  return <section id="distribution-actions">
    <h2>Distribution execution</h2>
    <p>Snapshot operator: {config.snapshot_operator_id}. Payouts use the frozen recipients and amounts in the company contract.</p>
    {!account && <button onClick={connect}>Connect operator wallet</button>}
    {account && !isOperator && <p>Connected as {account}. Switch to the snapshot operator to prepare distributions.</p>}
    {isOperator && <>
      <div className="governance-form">
        <h3>Prepare snapshot</h3>
        <p>Issued holdings only · ledger revision {totals.ledger_revision} · token {config.settlement_token_id}</p>
        <label>Budget in token base units<input inputMode="numeric" value={budget} onChange={event => setBudget(event.target.value.trim())} placeholder="1000000" /></label>
        <label>Expiry in UTC (ISO 8601)<input value={expiry} onChange={event => setExpiry(event.target.value.trim())} placeholder="2026-11-15T00:00:00Z" /></label>
        <button disabled={busy || config.paused || BigInt(totals.issued_total) === 0n} onClick={prepareSnapshot}>Create immutable snapshot</button>
      </div>
    </>}
    <h3>Pay fixed entitlements</h3>
    <p>A verified DAO council member queues unpaid recipients. The worker pays one at a time; confirmed token failures can be queued again. An uncertain callback blocks the queue for review.</p>
    {account && !isCouncil && <p>Connected as {account}. A council member must verify their wallet under Private profiles before queuing.</p>}
    {distributions.filter(d => d.funded && !d.cancelled).map(distribution => <article key={distribution.id}>
      <h3>Distribution #{distribution.id}</h3>
      {distribution.entitlements.map(row => <div className="payment-row" key={row.account_id}>
        <span>{row.account_id} · {row.amount} · {row.payment_status} · attempt {row.attempt_id}</span>
      </div>)}
      <><button disabled={busy || config.paused || !daoVerified || !isCouncil} onClick={() => void queue(distribution.id)}>Queue ready and failed recipients</button>
        <button disabled={busy} onClick={() => void refreshJobs(distribution.id).catch(error => setStatus(error instanceof Error ? error.message : "Queue status unavailable"))}>Refresh queue</button>
        {jobs[distribution.id]?.map(job => <p key={`${job.recipient_id}-${job.attempt_id}`}>
          {job.recipient_id} · attempt {job.attempt_id} · {job.submission_state}{job.tx_hash ? ` · ${job.tx_hash}` : ""}{job.last_error ? ` · ${job.last_error}` : ""}
        </p>)}</>
    </article>)}
    {status && <p role="status">{status}</p>}
  </section>;
}
