import { createHash } from "node:crypto";
import { deserialize } from "borsh";
import { DelegateAction, PublicKey, SCHEMA, Signature, baseEncode, encodeDelegateAction, encodeSignedDelegate, type SignedDelegate } from "near-api-js";

const maxGas = 30_000_000_000_000n;
const maxPayloadBytes = 4_096;
const validAccountId = (id: string) => /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id);

type Decoded = {
  delegateAction: { senderId: string; receiverId: string; actions: Array<{ functionCall?: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } }>;
    nonce: bigint; maxBlockHeight: bigint; publicKey: { ed25519Key?: { data: Uint8Array } } };
  signature: { ed25519Signature?: { data: Uint8Array } };
};

export function inspectSponsoredClaim(encoded: string, companyId: string, currentHeight: bigint) {
  if (!validAccountId(companyId) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Invalid delegate action encoding");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 100 || bytes.length > maxPayloadBytes || bytes.toString("base64") !== encoded) throw new Error("Invalid delegate action size or encoding");
  const decoded = deserialize(SCHEMA.SignedDelegate, bytes) as Decoded;
  const action = decoded.delegateAction;
  const call = action.actions.length === 1 ? action.actions[0].functionCall : undefined;
  if (!validAccountId(action.senderId) || action.receiverId !== companyId || !call || call.methodName !== "claim_vested" ||
      call.deposit !== 0n || call.gas < 10_000_000_000_000n || call.gas > maxGas ||
      action.maxBlockHeight <= currentHeight || action.maxBlockHeight > currentHeight + 200n) throw new Error("Delegate action is outside sponsor policy");
  let args: unknown;
  try { args = JSON.parse(Buffer.from(call.args).toString("utf8")); } catch { throw new Error("Invalid claim arguments"); }
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length !== 1 ||
      !Number.isSafeInteger((args as { grant_id?: unknown }).grant_id) || Number((args as { grant_id: number }).grant_id) < 0) throw new Error("Sponsor only accepts one grant ID");
  const keyBytes = decoded.delegateAction.publicKey.ed25519Key?.data;
  const signatureBytes = decoded.signature.ed25519Signature?.data;
  if (!keyBytes || keyBytes.length !== 32 || !signatureBytes || signatureBytes.length !== 64) throw new Error("Unsupported delegate signing key");
  const publicKey = PublicKey.fromString(`ed25519:${baseEncode(Uint8Array.from(keyBytes))}`);
  const delegate = new DelegateAction({ ...action, publicKey, actions: action.actions as DelegateAction["actions"] });
  const signature = new Signature({ keyType: publicKey.keyType, data: Uint8Array.from(signatureBytes) });
  const signed = { delegateAction: delegate, signature } as SignedDelegate;
  if (Buffer.compare(Buffer.from(encodeSignedDelegate(signed)), bytes) !== 0) throw new Error("Noncanonical delegate action");
  const digest = createHash("sha256").update(encodeDelegateAction(delegate)).digest();
  if (!publicKey.verify(digest, Uint8Array.from(signatureBytes))) throw new Error("Invalid delegate signature");
  return { signed, senderId: action.senderId, publicKey: publicKey.toString(), grantId: (args as { grant_id: number }).grant_id,
    gas: call.gas, nonce: action.nonce, maxBlockHeight: action.maxBlockHeight, digest: digest.toString("hex") };
}
