import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { test } from "node:test";
import { Account, JsonRpcProvider, KeyPairEd25519, baseEncode } from "near-api-js";
import { challengeMessage, nep413Digest, verifyNep413 } from "./auth-crypto.ts";

test("NEP-413 signature verifies only for the exact origin, nonce, and message", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublicKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const key = `ed25519:${baseEncode(rawPublicKey)}`;
  const nonce = randomBytes(32);
  const origin = "https://captab.example";
  const message = challengeMessage("alice.testnet", origin, "2026-11-01T00:05:00.000Z");
  const signature = sign(null, nep413Digest(message, nonce, "captab.example"), privateKey).toString("base64");
  const input = { message, nonce, recipient: "captab.example", publicKey: key, signature };
  assert.equal(verifyNep413(input), true);
  assert.equal(verifyNep413({ ...input, recipient: "other.example" }), false);
  assert.equal(verifyNep413({ ...input, nonce: randomBytes(32) }), false);
  assert.equal(verifyNep413({ ...input, message: `${message}\nextra` }), false);
  assert.equal(verifyNep413({ ...input, signature: "bad" }), false);
});

test("verifier accepts the official near-api-js NEP-413 signer output", async () => {
  const key = KeyPairEd25519.fromRandom();
  const account = new Account("alice.testnet", new JsonRpcProvider({ url: "http://127.0.0.1:1" }), key.toString());
  const nonce = randomBytes(32);
  const message = "CapTable testnet sign-in";
  const signed = await account.signNep413Message({ message, recipient: "captab.example", nonce });
  assert.equal(verifyNep413({ message, recipient: "captab.example", nonce,
    publicKey: signed.publicKey.toString(), signature: Buffer.from(signed.signature).toString("base64") }), true);
});
