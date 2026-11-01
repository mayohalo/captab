import { Account, JsonRpcProvider, KeyPairSigner, actions, buildDelegateAction } from "near-api-js";

const { SANDBOX_RPC_URL, SANDBOX_COMPANY_ID, SANDBOX_CONTRIBUTOR_ID, SANDBOX_CONTRIBUTOR_KEY,
  SANDBOX_RELAYER_ID, SANDBOX_RELAYER_KEY } = process.env;
if (![SANDBOX_RPC_URL, SANDBOX_COMPANY_ID, SANDBOX_CONTRIBUTOR_ID, SANDBOX_CONTRIBUTOR_KEY, SANDBOX_RELAYER_ID, SANDBOX_RELAYER_KEY].every(Boolean)) {
  throw new Error("Missing sandbox account configuration");
}

const provider = new JsonRpcProvider({ url: SANDBOX_RPC_URL });
const signer = KeyPairSigner.fromSecretKey(SANDBOX_CONTRIBUTOR_KEY);
const publicKey = await signer.getPublicKey();
const [accessKey, block] = await Promise.all([
  provider.viewAccessKey({ accountId: SANDBOX_CONTRIBUTOR_ID, publicKey: publicKey.toString() }),
  provider.viewBlock({ finality: "final" }),
]);
const delegate = buildDelegateAction({
  senderId: SANDBOX_CONTRIBUTOR_ID, receiverId: SANDBOX_COMPANY_ID,
  actions: [actions.functionCall("claim_vested", { grant_id: 0 }, 30_000_000_000_000n, 0n)],
  nonce: accessKey.nonce + 1n, maxBlockHeight: BigInt(block.header.height) + 100n, publicKey,
});
const { signedDelegate } = await signer.signDelegateAction(delegate);
const relayer = new Account(SANDBOX_RELAYER_ID, provider, SANDBOX_RELAYER_KEY);
const result = await relayer.relayMetaTransaction(signedDelegate);
if ("Failure" in result.status) throw new Error(`Sponsored claim failed: ${JSON.stringify(result.status)}`);
const holding = await provider.callFunction({ contractId: SANDBOX_COMPANY_ID, method: "get_holding", args: { account_id: SANDBOX_CONTRIBUTOR_ID } });
if (holding !== "100") throw new Error(`Expected 100 claimed units, got ${holding}`);
console.log("Sponsored zero-balance claim settled:", result.transaction.hash);
