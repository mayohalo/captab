import { createHash, createPublicKey, verify } from "node:crypto";
import { baseDecode } from "near-api-js";

const tag = 2 ** 31 + 413;

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const size = Buffer.alloc(4);
  size.writeUInt32LE(bytes.length);
  return Buffer.concat([size, bytes]);
}

export function nep413Digest(message: string, nonce: Uint8Array, recipient: string): Buffer {
  if (nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(tag);
  return createHash("sha256").update(Buffer.concat([
    prefix, borshString(message), Buffer.from(nonce), borshString(recipient), Buffer.from([0]),
  ])).digest();
}

export function verifyNep413(input: { message: string; nonce: Uint8Array; recipient: string; publicKey: string; signature: string }): boolean {
  if (!input.publicKey.startsWith("ed25519:") || !/^[A-Za-z0-9+/]{86}==$/.test(input.signature)) return false;
  try {
    const rawKey = Buffer.from(baseDecode(input.publicKey.slice(8)));
    const rawSignature = Buffer.from(input.signature, "base64");
    if (rawKey.length !== 32 || rawSignature.length !== 64) return false;
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawKey]);
    return verify(null, nep413Digest(input.message, input.nonce, input.recipient), createPublicKey({ key: spki, format: "der", type: "spki" }), rawSignature);
  } catch { return false; }
}

export function challengeMessage(accountId: string, origin: string, expiresAt: string): string {
  return `CapTable testnet sign-in\nAccount: ${accountId}\nOrigin: ${origin}\nExpires: ${expiresAt}`;
}
