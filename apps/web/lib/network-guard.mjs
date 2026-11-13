// A configured endpoint's chain ID does not change, so a successful check is reused for a short time instead of
// costing one extra RPC call per contract read. Failures are never cached: a mainnet or unreachable endpoint
// fails closed on every call.
const VERIFIED_FOR_MS = 60_000;
const verified = new WeakMap();

export async function requireTestnet(provider, now = Date.now()) {
  const until = verified.get(provider);
  if (until !== undefined && now < until) return;
  const networkId = await provider.getNetworkId();
  if (networkId !== "testnet") {
    verified.delete(provider);
    throw new Error(`NEAR RPC must be testnet; received ${networkId}`);
  }
  verified.set(provider, now + VERIFIED_FOR_MS);
}
