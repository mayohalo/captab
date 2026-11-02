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
