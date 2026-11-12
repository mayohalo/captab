"use client";

import { NearConnector, type NearWalletBase } from "@hot-labs/near-connect";
import { useEffect, useState } from "react";
import { observeTransaction } from "../lib/observe";
import { describeObservation } from "../lib/observed-status.mjs";

let connector: NearConnector | undefined;
declare global { interface Window { __CAPTAB_E2E_CONNECTOR__?: NearConnector } }
export function getConnector() {
  if (process.env.NEXT_PUBLIC_CAPTAB_E2E_WALLET === "enabled" && typeof window !== "undefined" &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname) && window.__CAPTAB_E2E_CONNECTOR__) {
    return window.__CAPTAB_E2E_CONNECTOR__;
  }
  if (!connector) connector = new NearConnector({ network: "testnet" });
  return connector;
}

export function WalletControl({ contractId, grantId, recipient, claimable, companyVerified = false, termsHash, accepted = false }: {
  contractId?: string; grantId?: number; recipient?: string; claimable?: string; companyVerified?: boolean;
  /** Schema v2: the board's grant document hash, which the recipient accepts on chain. */
  termsHash?: string; accepted?: boolean;
}) {
  const [wallet, setWallet] = useState<NearWalletBase | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    getConnector().getConnectedWallet().then(({ wallet, accounts }) => {
      if (active) { setWallet(wallet); setAccount(accounts[0]?.accountId ?? null); }
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  async function connect() {
    try { const selected = await getConnector().connect(); const accounts = await selected.getAccounts(); setWallet(selected); setAccount(accounts[0]?.accountId ?? null); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Wallet connection failed"); }
  }
  async function disconnect() { await getConnector().disconnect(wallet ?? undefined); setWallet(null); setAccount(null); }
  async function claim() {
    if (!wallet || !contractId || grantId === undefined || !companyVerified) return;
    setBusy(true);
    setStatus("Awaiting wallet signature…");
    try {
      const outcome = await wallet.signAndSendTransaction({ receiverId: contractId, actions: [{ type: "FunctionCall", params: { methodName: "claim_vested", args: { grant_id: grantId }, gas: "30000000000000", deposit: "0" } }] });
      if (outcome.status === "Failure" || (typeof outcome.status === "object" && outcome.status !== null && "Failure" in outcome.status)) {
        throw new Error(`Claim failed: ${JSON.stringify(outcome.status)}`);
      }
      setStatus(`Submitted claim ${outcome.transaction.hash}. Waiting for receipt observation…`);
      const observed = account ? await observeTransaction(contractId, account, outcome.transaction.hash) : null;
      setStatus(`Claim transaction ${outcome.transaction.hash}. ${describeObservation(observed)}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Claim failed"); }
    finally { setBusy(false); }
  }
  async function acceptTerms() {
    if (!wallet || !contractId || grantId === undefined || !termsHash || !companyVerified) return;
    setBusy(true);
    setStatus("Awaiting wallet signature to accept the grant terms…");
    try {
      const outcome = await wallet.signAndSendTransaction({ receiverId: contractId, actions: [{ type: "FunctionCall", params: {
        methodName: "accept_grant", args: { grant_id: grantId, terms_hash: termsHash }, gas: "30000000000000", deposit: "0" } }] });
      if (outcome.status === "Failure" || (typeof outcome.status === "object" && outcome.status !== null && "Failure" in outcome.status)) {
        throw new Error(`Acceptance failed: ${JSON.stringify(outcome.status)}`);
      }
      const observed = account ? await observeTransaction(contractId, account, outcome.transaction.hash) : null;
      setStatus(`Accepted grant terms in ${outcome.transaction.hash}. ${describeObservation(observed)}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Acceptance failed"); }
    finally { setBusy(false); }
  }
  return <div className="wallet">
    {account ? <><span>{account}</span><button disabled={busy} onClick={disconnect}>Disconnect</button></> : <button onClick={connect}>Connect wallet</button>}
    {contractId && grantId !== undefined && account === recipient && BigInt(claimable ?? "0") > 0n && <button disabled={busy || !companyVerified} onClick={claim}>Claim vested units</button>}
    {contractId && grantId !== undefined && termsHash && account === recipient && !accepted &&
      <button disabled={busy || !companyVerified} onClick={acceptTerms}>Accept grant terms</button>}
    {termsHash && <p className="hash">Grant document <code>{termsHash.slice(0, 12)}…</code>{accepted ? " · accepted by recipient" : " · not yet accepted"}</p>}
    {status && <p role="status">{status}</p>}
  </div>;
}
