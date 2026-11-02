"use client";

import { type NearWalletBase } from "@hot-labs/near-connect";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type Distribution, type Grant, type Holding, formatUnits } from "../lib/near";
import { getConnector } from "./wallet";
import { observeTransaction } from "../lib/observe";
import { describeObservation } from "../lib/observed-status.mjs";
import { PrivateProfiles } from "./private-profiles";

export function PersonalView({ companyId, holdings, grants, distributions, companyVerified }: {
  companyId: string; holdings: Holding[]; grants: Grant[]; distributions: Distribution[]; companyVerified: boolean;
}) {
  const router = useRouter();
  const [wallet, setWallet] = useState<NearWalletBase | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const ownGrants = grants.filter(grant => grant.recipient === account);
  const ownEntitlements = distributions.flatMap(distribution => distribution.entitlements
    .filter(row => row.account_id === account)
    .map(row => ({ distribution, row })));
  const holding = holdings.find(row => row.account_id === account);

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

  async function claim(grantId: number) {
    if (!wallet || !account || !companyVerified) return;
    setBusy(true);
    setStatus("Awaiting wallet signature…");
    try {
      const outcome = await wallet.signAndSendTransaction({
        receiverId: companyId,
        actions: [{ type: "FunctionCall", params: {
          methodName: "claim_vested", args: { grant_id: grantId }, gas: "30000000000000", deposit: "0",
        } }],
      });
      if (outcome.status === "Failure" || (typeof outcome.status === "object" && outcome.status !== null && "Failure" in outcome.status)) {
        throw new Error(`Claim failed: ${JSON.stringify(outcome.status)}`);
      }
      setStatus(`Submitted claim ${outcome.transaction.hash}. Waiting for receipt observation…`);
      const observed = await observeTransaction(companyId, account, outcome.transaction.hash);
      setStatus(`Claim transaction ${outcome.transaction.hash}. ${describeObservation(observed)}`);
      router.refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Claim failed"); }
    finally { setBusy(false); }
  }

  async function claimSponsored(grantId: number) {
    if (!wallet || !account || !companyVerified) return;
    setBusy(true);
    setStatus("Awaiting delegated claim signature…");
    try {
      if (!wallet.manifest.features.signDelegateActions) throw new Error("This wallet does not support delegated actions");
      const signed = await wallet.signDelegateActions({ signerId: account, delegateActions: [{ receiverId: companyId,
        actions: [{ type: "FunctionCall", params: { methodName: "claim_vested", args: { grant_id: grantId }, gas: "30000000000000", deposit: "0" } }] }] });
      if (signed.signedDelegateActions.length !== 1) throw new Error("Wallet did not return one signed claim");
      const response = await fetch("/api/sponsor", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, signedDelegate: signed.signedDelegateActions[0] }) });
      const result = await response.json() as { txHash?: string; error?: string };
      if (!response.ok || !result.txHash) throw new Error(result.error ?? "Sponsorship failed");
      setStatus(`Sponsored claim submitted: ${result.txHash}. Refresh after finality to see updated units.`);
      router.refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Sponsored claim failed"); }
    finally { setBusy(false); }
  }

  return <main>
    <header><div><Link href={`/company/${companyId}`}>← {companyId}</Link><h1>My ownership</h1><p>NEAR testnet · public on-chain holdings and entitlements</p></div></header>
    {!companyVerified && <p role="alert">Company code is not verified. Claims are disabled.</p>}
    {!account ? <section><p>Connect the NEAR account that holds your units or grants.</p><button onClick={connect}>Connect wallet</button></section> : <>
      <section className="metrics"><article><span>Account</span><strong className="account-label">{account}</strong></article><article><span>Issued units</span><strong>{formatUnits(holding?.issued_units ?? "0")}</strong></article><article><span>Active grants</span><strong>{ownGrants.filter(grant => grant.cancelled_at === null).length}</strong></article><article><span>Distributions</span><strong>{ownEntitlements.length}</strong></article></section>
      <section><h2>My grants</h2><div className="cards">{ownGrants.map(grant => <article key={grant.id}>
        <h3>Grant #{grant.id}</h3><p>{formatUnits(grant.original_units)} granted · {formatUnits(grant.vested_units)} vested · {formatUnits(grant.issued_units)} claimed</p>
        <p>{formatUnits(grant.claimable_units)} claimable now · {grant.cancelled_at === null ? "active" : "cancelled, vested rights retained"}</p>
        <p>Cliff {new Date(grant.boundaries[12] * 1000).toUTCString()} · end {new Date(grant.boundaries[48] * 1000).toUTCString()}</p>
        {BigInt(grant.claimable_units) > 0n && <><button disabled={busy || !companyVerified} onClick={() => void claim(grant.id)}>Claim with wallet gas</button>{wallet?.manifest.features.signDelegateActions && <button disabled={busy || !companyVerified} onClick={() => void claimSponsored(grant.id)}>Sponsored claim</button>}</>}
      </article>)}</div>{ownGrants.length === 0 && <p>No grants for this account.</p>}</section>
      <section><h2>My distributions</h2><div className="cards">{ownEntitlements.map(({ distribution, row }) => <article key={distribution.id}>
        <h3>Distribution #{distribution.id}</h3><p>{formatUnits(row.amount)} token base units · {distribution.token_id}</p><p>Status: {row.payment_status} · attempt {row.attempt_id}</p>
      </article>)}</div>{ownEntitlements.length === 0 && <p>No distribution entitlements for this account.</p>}</section>
      <p>Sponsored claims require a wallet that supports delegated actions. The relayer pays the outer transaction fee after validating your signed claim.</p>
    </>}
    <PrivateProfiles companyId={companyId} />
    {status && <p role="status">{status}</p>}
  </main>;
}
