"use client";

import { type NearWalletBase } from "@hot-labs/near-connect";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type CompanyConfig, type Distribution, type Totals } from "../lib/near";
import { getConnector } from "./wallet";

export function DistributionOperator({ id, config, totals, distributions }: {
  id: string; config: CompanyConfig; totals: Totals; distributions: Distribution[];
}) {
  const router = useRouter();
  const [wallet, setWallet] = useState<NearWalletBase | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [expiry, setExpiry] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const isOperator = account === config.snapshot_operator_id;

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
    if (!wallet) return;
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
      setStatus(`Transaction ${outcome.transaction.hash}. Refresh to verify the company state and payment callback.`);
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

  return <section id="distribution-actions">
    <h2>Distribution execution</h2>
    <p>Snapshot operator: {config.snapshot_operator_id}. Payouts use the frozen recipients and amounts in the company contract.</p>
    {!account && <button onClick={connect}>Connect operator wallet</button>}
    {account && !isOperator && <p>Connected as {account}. Switch to the snapshot operator to prepare or execute distributions.</p>}
    {isOperator && <>
      <div className="governance-form">
        <h3>Prepare snapshot</h3>
        <p>Issued holdings only · ledger revision {totals.ledger_revision} · token {config.settlement_token_id}</p>
        <label>Budget in token base units<input inputMode="numeric" value={budget} onChange={event => setBudget(event.target.value.trim())} placeholder="1000000" /></label>
        <label>Expiry in UTC (ISO 8601)<input value={expiry} onChange={event => setExpiry(event.target.value.trim())} placeholder="2026-11-15T00:00:00Z" /></label>
        <button disabled={busy || config.paused || BigInt(totals.issued_total) === 0n} onClick={prepareSnapshot}>Create immutable snapshot</button>
      </div>
      <h3>Pay fixed entitlements</h3>
      <p>After DAO approval and exact token funding, execute one recipient at a time. A confirmed token failure becomes retryable; an in-flight payment remains locked for review.</p>
      {distributions.filter(d => d.funded && !d.cancelled).map(distribution => <article key={distribution.id}>
        <h3>Distribution #{distribution.id}</h3>
        {distribution.entitlements.map(row => <div className="payment-row" key={row.account_id}>
          <span>{row.account_id} · {row.amount} · {row.payment_status} · attempt {row.attempt_id}</span>
          {(row.payment_status === "Ready" || row.payment_status === "Failed") && <button disabled={busy || config.paused} onClick={() => void send("pay_recipient", { distribution_id: distribution.id, recipient_id: row.account_id }, "100000000000000")}>{row.payment_status === "Failed" ? "Retry payment" : "Pay recipient"}</button>}
        </div>)}
      </article>)}
    </>}
    {status && <p role="status">{status}</p>}
  </section>;
}
