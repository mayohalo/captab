export async function requireTestnet(provider) {
  const networkId = await provider.getNetworkId();
  if (networkId !== "testnet") throw new Error(`NEAR RPC must be testnet; received ${networkId}`);
}
