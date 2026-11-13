import assert from "node:assert/strict";
import test from "node:test";
import { requireTestnet } from "./network-guard.mjs";

test("testnet RPC passes", async () => {
  await requireTestnet({ getNetworkId: async () => "testnet" });
});

test("mainnet and unknown network IDs fail closed", async () => {
  await assert.rejects(requireTestnet({ getNetworkId: async () => "mainnet" }), /must be testnet/);
  await assert.rejects(requireTestnet({ getNetworkId: async () => undefined }), /must be testnet/);
});

test("an unavailable RPC cannot pass the network check", async () => {
  await assert.rejects(requireTestnet({ getNetworkId: async () => { throw new Error("RPC unavailable"); } }), /RPC unavailable/);
});

test("a verified testnet endpoint is reused briefly, then checked again", async () => {
  let calls = 0;
  const provider = { getNetworkId: async () => { calls += 1; return "testnet"; } };
  await requireTestnet(provider, 1_000);
  await requireTestnet(provider, 30_000);
  assert.equal(calls, 1);
  await requireTestnet(provider, 61_001);
  assert.equal(calls, 2);
});

test("a failed check is never cached", async () => {
  let network = "mainnet";
  const provider = { getNetworkId: async () => network };
  await assert.rejects(requireTestnet(provider, 1_000), /must be testnet/);
  network = "testnet";
  await requireTestnet(provider, 2_000);
  network = "mainnet";
  await requireTestnet(provider, 3_000); // cached success within the window
  await assert.rejects(requireTestnet(provider, 70_000), /must be testnet/);
});
