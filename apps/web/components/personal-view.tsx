"use client";

import { type NearWalletBase } from "@hot-labs/near-connect";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type Distribution, type Grant, type Holding, formatUnits } from "../lib/near";
import { getConnector } from "./wallet";
import { observeTransaction } from "../lib/observe";
import { PrivateProfiles } from "./private-profiles";

export function PersonalView({ companyId, holdings, grants, distributions }: {
  companyId: string; holdings: Holding[]; grants: Grant[]; distributions: Distribution[];
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
    if (!wallet || !account) return;
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
      const observed = await observeTransaction(companyId, account, outcome.transaction.hash);
      setStatus(`Claim transaction ${outcome.transaction.hash}. Refresh to verify your updated holdings.${observed ? ` History: ${observed.status}.` : " History sync unavailable; keep this hash."}`);
      router.refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Claim failed"); }
    finally { setBusy(false); }
  }

  return <main>
    <header><div><Link href={`/company/${companyId}`}>← {companyId}</Link><h1>My ownership</h1><p>NEAR testnet · public on-chain holdings and entitlements</p></div></header>
    {!account ? <section><p>Connect the NEAR account that holds your units or grants.</p><button onClick={connect}>Connect wallet</button></section> : <>
      <section className="metrics"><article><span>Account</span><strong className="account-label">{account}</strong></article><article><span>Issued units</span><strong>{formatUnits(holding?.issued_units ?? "0")}</strong></article><article><span>Active grants</span><strong>{ownGrants.filter(grant => grant.cancelled_at === null).length}</strong></article><article><span>Distributions</span><strong>{ownEntitlements.length}</strong></article></section>
      <section><h2>My grants</h2><div className="cards">{ownGrants.map(grant => <article key={grant.id}>
        <h3>Grant #{grant.id}</h3><p>{formatUnits(grant.original_units)} granted · {formatUnits(grant.vested_units)} vested · {formatUnits(grant.issued_units)} claimed</p>
        <p>{formatUnits(grant.claimable_units)} claimable now · {grant.cancelled_at === null ? "active" : "cancelled, vested rights retained"}</p>
        <p>Cliff {new Date(grant.boundaries[12] * 1000).toUTCString()} · end {new Date(grant.boundaries[48] * 1000).toUTCString()}</p>
        {BigInt(grant.claimable_units) > 0n && <button disabled={busy} onClick={() => void claim(grant.id)}>Claim vested units</button>}
      </article>)}</div>{ownGrants.length === 0 && <p>No grants for this account.</p>}</section>
      <section><h2>My distributions</h2><div className="cards">{ownEntitlements.map(({ distribution, row }) => <article key={distribution.id}>
        <h3>Distribution #{distribution.id}</h3><p>{formatUnits(row.amount)} token base units · {distribution.token_id}</p><p>Status: {row.payment_status} · attempt {row.attempt_id}</p>
      </article>)}</div>{ownEntitlements.length === 0 && <p>No distribution entitlements for this account.</p>}</section>
      <p>Claims from this screen use your wallet for gas. Sponsored claims are not available yet.</p>
    </>}
    <PrivateProfiles companyId={companyId} />
    {status && <p role="status">{status}</p>}
  </main>;
}
