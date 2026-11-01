"use client";

import { NearConnector, type NearWalletBase } from "@hot-labs/near-connect";
import { useEffect, useState } from "react";

let connector: NearConnector | undefined;
function getConnector() { if (!connector) connector = new NearConnector({ network: "testnet" }); return connector; }

export function WalletControl({ contractId, grantId, recipient, claimable }: { contractId?: string; grantId?: number; recipient?: string; claimable?: string }) {
  const [wallet, setWallet] = useState<NearWalletBase | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [status, setStatus] = useState("");
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
    if (!wallet || !contractId || grantId === undefined) return;
    setStatus("Awaiting wallet signature…");
    try {
      const outcome = await wallet.signAndSendTransaction({ receiverId: contractId, actions: [{ type: "FunctionCall", params: { methodName: "claim_vested", args: { grant_id: grantId }, gas: "30000000000000", deposit: "0" } }] });
      setStatus(`Submitted ${outcome.transaction.hash}. Refresh after confirmation.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Claim failed"); }
  }
  return <div className="wallet">
    {account ? <><span>{account}</span><button onClick={disconnect}>Disconnect</button></> : <button onClick={connect}>Connect wallet</button>}
    {contractId && grantId !== undefined && account === recipient && BigInt(claimable ?? "0") > 0n && <button onClick={claim}>Claim vested units</button>}
    {status && <p role="status">{status}</p>}
  </div>;
}
