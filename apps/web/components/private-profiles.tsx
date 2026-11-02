"use client";

import { useCallback, useEffect, useState } from "react";
import { getConnector } from "./wallet";

type Profile = { account_id: string; display_name: string | null; email: string | null };

export function PrivateProfiles({ companyId }: { companyId: string }) {
  const [account, setAccount] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [council, setCouncil] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const refresh = useCallback(async () => {
    const session = await fetch("/api/auth/session", { cache: "no-store" }).then(response => response.json()) as { accountId: string | null };
    setAccount(session.accountId);
    if (!session.accountId) { setProfiles([]); setCouncil(false); return; }
    const response = await fetch(`/api/companies/${companyId}/stakeholders`, { cache: "no-store" });
    if (!response.ok) throw new Error("Private profiles are unavailable");
    const result = await response.json() as { council: boolean; profiles: Profile[] };
    setProfiles(result.profiles);
    setCouncil(result.council);
  }, [companyId]);

  useEffect(() => { void refresh().catch(() => setStatus("Private profiles are unavailable")); }, [refresh]);

  async function signIn() {
    setBusy(true);
    setStatus("Requesting wallet signature…");
    try {
      const connector = getConnector();
      let { wallet, accounts } = await connector.getConnectedWallet();
      if (!wallet || !accounts[0]) {
        wallet = await connector.connect();
        accounts = await wallet.getAccounts();
      }
      const accountId = accounts[0]?.accountId;
      if (!wallet || !accountId) throw new Error("Connect a NEAR wallet first");
      const challengeResponse = await fetch("/api/auth/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId }) });
      const challenge = await challengeResponse.json() as { nonce?: string; message?: string; recipient?: string; error?: string };
      if (!challengeResponse.ok || !challenge.nonce || !challenge.message || !challenge.recipient) throw new Error(challenge.error ?? "Challenge failed");
      const nonce = Uint8Array.from(atob(challenge.nonce), character => character.charCodeAt(0));
      const signed = await wallet.signMessage({ message: challenge.message, recipient: challenge.recipient, nonce, signerId: accountId });
      if (signed.accountId !== accountId) throw new Error("Wallet signed with another account");
      const verifyResponse = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce: challenge.nonce, accountId, publicKey: signed.publicKey, signature: signed.signature }) });
      const verified = await verifyResponse.json() as { error?: string };
      if (!verifyResponse.ok) throw new Error(verified.error ?? "Wallet verification failed");
      await refresh();
      setStatus(`Verified ${accountId}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Wallet verification failed"); }
    finally { setBusy(false); }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    await refresh();
    setStatus("Signed out of private profiles");
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`/api/companies/${companyId}/stakeholders`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: target.trim(), displayName: name.trim() || null, email: email.trim() || null }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Save failed");
      await refresh();
      setStatus(`Saved private profile for ${target.trim()}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Save failed"); }
    finally { setBusy(false); }
  }

  return <section id="private-profiles"><h2>Private profiles</h2>
    <p>Names and email addresses are stored off-chain. Council members may edit them; contributors can view only their own record.</p>
    {!account ? <button disabled={busy} onClick={() => void signIn()}>Verify wallet to view profiles</button> : <p>Verified as {account} · <button onClick={() => void signOut()}>Sign out</button></p>}
    {account && <><p>{council ? "Council access" : "Personal access"}</p>
      <div className="table-scroll" role="region" aria-label="Private profiles table" tabIndex={0}><table><thead><tr><th>Account</th><th>Name</th><th>Email</th></tr></thead><tbody>{profiles.map(profile => <tr key={profile.account_id}>
        <td>{profile.account_id}</td><td>{profile.display_name ?? "—"}</td><td>{profile.email ?? "—"}</td>
      </tr>)}</tbody></table></div>
      {profiles.length === 0 && <p>No private profile has been saved.</p>}
      {council && <form className="governance-form" onSubmit={event => void saveProfile(event)}><h3>Edit stakeholder profile</h3>
        <label>On-chain stakeholder account <input value={target} onChange={event => setTarget(event.target.value)} required /></label>
        <label>Name <input value={name} onChange={event => setName(event.target.value)} maxLength={120} /></label>
        <label>Email <input value={email} onChange={event => setEmail(event.target.value)} type="email" maxLength={254} /></label>
        <button disabled={busy}>Save private profile</button>
      </form>}
    </>}
    {status && <p role="status">{status}</p>}
  </section>;
}
