import assert from "node:assert/strict";
import { test } from "node:test";
import { KeyPairEd25519, KeyPairSigner, actions, buildDelegateAction, encodeSignedDelegate } from "near-api-js";
import { inspectSponsoredClaim } from "./sponsor-policy.ts";

const key = KeyPairEd25519.fromRandom();
const signer = new KeyPairSigner(key);

async function signedClaim({ receiverId = "company.testnet", methodName = "claim_vested", args = { grant_id: 3 }, gas = 30_000_000_000_000n, deposit = 0n, maxBlockHeight = 150n } = {}) {
  const delegate = buildDelegateAction({ senderId: "alice.testnet", receiverId, publicKey: key.getPublicKey(), nonce: 1n, maxBlockHeight,
    actions: [actions.functionCall(methodName, args, gas, deposit)] });
  const { signedDelegate } = await signer.signDelegateAction(delegate);
  return Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64");
}

test("valid signed claim decodes and verifies against its key and policy", async () => {
  const inspected = inspectSponsoredClaim(await signedClaim(), "company.testnet", 100n);
  assert.equal(inspected.senderId, "alice.testnet");
  assert.equal(inspected.grantId, 3);
  assert.equal(inspected.gas, 30_000_000_000_000n);
  assert.match(inspected.digest, /^[a-f0-9]{64}$/);
});

test("sponsor rejects other receivers, methods, deposits, expiry, and damaged signatures", async () => {
  for (const options of [
    { receiverId: "other.testnet" }, { methodName: "issue_founder_units" }, { deposit: 1n },
    { maxBlockHeight: 100n }, { maxBlockHeight: 301n },
    { gas: 9_999_999_999_999n }, { gas: 30_000_000_000_001n },
    { args: { grant_id: 3, recipient: "mallory.testnet" } },
  ]) {
    const encoded = await signedClaim(options);
    assert.throws(() => inspectSponsoredClaim(encoded, "company.testnet", 100n));
  }
  const bytes = Buffer.from(await signedClaim(), "base64");
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => inspectSponsoredClaim(bytes.toString("base64"), "company.testnet", 100n), /signature/);
});
