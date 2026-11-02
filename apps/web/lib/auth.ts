import { createHash, randomBytes, randomUUID } from "node:crypto";
import { JsonRpcProvider } from "near-api-js";
import { getDatabase } from "./db";
import { challengeMessage, verifyNep413 } from "./auth-crypto";
import { assertTestnetNetwork, validAccountId } from "./near";

const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org" });
const challengeMinutes = 5;
const sessionHours = 12;

type ChallengeRow = { id: string; account_id: string; challenge_nonce_hash: string; challenge_expires_at: string; domain: string; verified_at: string | null };

export function authOrigin(request: Request): string {
  const configured = process.env.CAPTAB_AUTH_ORIGIN;
  if (!configured && process.env.NODE_ENV === "production") throw new Error("CAPTAB_AUTH_ORIGIN must be configured");
  const origin = new URL(configured ?? request.url).origin;
  if (!origin.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new Error("Authentication requires HTTPS");
  return origin;
}

export function assertRequestOrigin(request: Request, origin: string) {
  if (request.headers.get("origin") !== origin) throw new Error("Request origin mismatch");
}

export function createChallenge(accountId: string, origin: string) {
  if (!validAccountId(accountId)) throw new Error("Invalid NEAR account ID");
  const nonce = randomBytes(32);
  const expiresAt = new Date(Date.now() + challengeMinutes * 60_000).toISOString();
  const id = randomUUID();
  const db = getDatabase();
  db.prepare(`INSERT INTO sessions (id, account_id, challenge_nonce_hash, challenge_expires_at, domain)
    VALUES (?, ?, ?, ?, ?)`).run(id, accountId, createHash("sha256").update(nonce).digest("hex"), expiresAt, origin);
  return { id, nonce: nonce.toString("base64"), message: challengeMessage(accountId, origin, expiresAt), recipient: new URL(origin).host, expiresAt };
}

export async function verifyChallenge(input: { challengeId: string; nonce: string; accountId: string; publicKey: string; signature: string }, origin: string) {
  await assertTestnetNetwork();
  const db = getDatabase();
  const row = db.prepare("SELECT id, account_id, challenge_nonce_hash, challenge_expires_at, domain, verified_at FROM sessions WHERE id = ?")
    .get(input.challengeId) as ChallengeRow | undefined;
  if (!row || row.verified_at || row.account_id !== input.accountId || row.domain !== origin || Date.parse(row.challenge_expires_at) <= Date.now()) throw new Error("Challenge is invalid or expired");
  const nonce = Buffer.from(input.nonce, "base64");
  if (nonce.length !== 32 || createHash("sha256").update(nonce).digest("hex") !== row.challenge_nonce_hash) throw new Error("Challenge nonce mismatch");
  const message = challengeMessage(row.account_id, row.domain, row.challenge_expires_at);
  if (!verifyNep413({ message, nonce, recipient: new URL(origin).host, publicKey: input.publicKey, signature: input.signature })) throw new Error("Invalid wallet signature");
  const accessKey = await provider.viewAccessKey({ accountId: row.account_id, publicKey: input.publicKey });
  if (accessKey.permission !== "FullAccess") throw new Error("Signing key is not a full-access key");
  const sessionExpiresAt = new Date(Date.now() + sessionHours * 60 * 60_000).toISOString();
  const changed = db.prepare(`UPDATE sessions SET verified_at = ?, session_expires_at = ?
    WHERE id = ? AND verified_at IS NULL AND challenge_expires_at > ?`).run(new Date().toISOString(), sessionExpiresAt, row.id, new Date().toISOString()).changes;
  if (changed !== 1) throw new Error("Challenge was already used or expired");
  return { sessionId: row.id, accountId: row.account_id, sessionExpiresAt };
}

export function accountFromSession(request: Request): string | null {
  const cookie = request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith("captab_session="));
  const id = cookie?.slice("captab_session=".length);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = getDatabase().prepare(`SELECT account_id FROM sessions WHERE id = ? AND verified_at IS NOT NULL AND session_expires_at > ?`)
    .get(id, new Date().toISOString()) as { account_id: string } | undefined;
  return row?.account_id ?? null;
}
