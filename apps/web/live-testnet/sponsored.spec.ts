import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPairSigner, actions, buildDelegateAction, encodeSignedDelegate, teraToGas } from "near-api-js";

const credentials = JSON.parse(await readFile(resolve(process.cwd(), ".data/testnet-accounts.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(process.cwd(), "../../docs/deployment-manifest.testnet.json"), "utf8"));
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const contributorId = credentials.accounts.contributor.accountId as string;
const start = Date.UTC(2025, 9, 1) / 1000;
const boundaries = Array.from({ length: 49 }, (_, month) => Date.UTC(2025, 9 + month, 1) / 1000);

async function view(contractId: string, method: string, args: Record<string, unknown> = {}) {
  return provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } });
}

function assertSuccess(outcome: { status: unknown; transaction: { hash: string } }, label: string) {
  if (!outcome.status || typeof outcome.status !== "object" || !("SuccessValue" in outcome.status || "SuccessReceiptId" in outcome.status)) {
    throw new Error(`${label} failed: ${outcome.transaction.hash}`);
  }
  return outcome.transaction.hash;
}

async function ensureSponsorGrant() {
  const grants = await view(manifest.companyId, "list_grants", { from_index: 0, limit: 20 }) as Array<{
    id: number; recipient: string; original_units: string; boundaries: number[]; issued_units: string;
  }>;
  const existing = grants.find(grant => grant.recipient === contributorId && grant.original_units === "400" && grant.boundaries[0] === start);
  if (existing) return existing.id;
  const totals = await view(manifest.companyId, "get_totals") as { ledger_revision: number; pool_available: string };
  expect(BigInt(totals.pool_available)).toBeGreaterThanOrEqual(400n);
  const proposal = { description: "Live browser sponsored claim grant", kind: { FunctionCall: {
    receiver_id: manifest.companyId, actions: [{ method_name: "create_grant",
      args: Buffer.from(JSON.stringify({ action_id: "live-browser-sponsored-grant-v1", expected_revision: totals.ledger_revision,
        recipient: contributorId, units: "400", boundaries })).toString("base64"),
      gas: "80000000000000", deposit: "0" }],
  } } };
  const first = new Account(credentials.accounts.council1.accountId, provider, credentials.accounts.council1.privateKey);
  const second = new Account(credentials.accounts.council2.accountId, provider, credentials.accounts.council2.privateKey);
  const policy = await view(manifest.daoId, "get_policy") as { proposal_bond: string };
  const added = await first.callFunctionRaw({ contractId: manifest.daoId, methodName: "add_proposal", args: { proposal },
    gas: teraToGas(180), deposit: BigInt(policy.proposal_bond), waitUntil: "FINAL" });
  const addHash = assertSuccess(added, "Sponsored grant proposal");
  const proposalId = JSON.parse(Buffer.from((added.status as { SuccessValue: string }).SuccessValue, "base64").toString("utf8")) as number;
  const votes = [];
  for (const member of [first, second]) {
    const voted = await member.callFunctionRaw({ contractId: manifest.daoId, methodName: "act_proposal",
      args: { id: proposalId, action: "VoteApprove", proposal: proposal.kind }, gas: teraToGas(220), deposit: 0n, waitUntil: "FINAL" });
    votes.push(assertSuccess(voted, "Sponsored grant vote"));
  }
  const approved = await view(manifest.daoId, "get_proposal", { id: proposalId }) as { status: string };
  expect(approved.status).toBe("Approved");
  const updated = await view(manifest.companyId, "list_grants", { from_index: 0, limit: 20 }) as Array<{
    id: number; recipient: string; original_units: string; boundaries: number[];
  }>;
  const grant = updated.find(item => item.recipient === contributorId && item.original_units === "400" && item.boundaries[0] === start);
  if (!grant) throw new Error("Sponsored claim grant was not created");
  console.log(JSON.stringify({ grantId: grant.id, proposalId, addHash, votes }));
  return grant.id;
}

test("local contributor wallet signs a live sponsored claim from the browser", async ({ page }) => {
  expect(await provider.getNetworkId()).toBe("testnet");
  expect(credentials.network).toBe("testnet");
  expect(credentials.accounts.company.accountId).toBe(manifest.companyId);
  const grantId = await ensureSponsorGrant();
  const before = await view(manifest.companyId, "get_grant", { grant_id: grantId }) as { claimable_units: string; issued_units: string };
  if (before.issued_units === "100") {
    expect(before.claimable_units).toBe("0");
    console.log(JSON.stringify({ grantId, status: "already sponsored and claimed" }));
    return;
  }
  expect(before.claimable_units).toBe("100");
  await page.exposeFunction("__captabLocalDelegate", async (request: { signerId: string; delegateActions: Array<{
    receiverId: string; actions: Array<{ type: string; params: { methodName: string; args: { grant_id: number }; gas: string; deposit: string } }>;
  }> }) => {
    if (request.signerId !== contributorId || request.delegateActions.length !== 1) throw new Error("Unexpected delegate signer");
    const call = request.delegateActions[0];
    if (call.receiverId !== manifest.companyId || call.actions.length !== 1 || call.actions[0].type !== "FunctionCall" ||
        call.actions[0].params.methodName !== "claim_vested" || call.actions[0].params.args.grant_id !== grantId) {
      throw new Error("Local test wallet accepts this claim only");
    }
    const signer = KeyPairSigner.fromSecretKey(credentials.accounts.contributor.privateKey);
    const publicKey = await signer.getPublicKey();
    const [accessKey, block] = await Promise.all([
      provider.viewAccessKey({ accountId: contributorId, publicKey: publicKey.toString() }),
      provider.viewBlock({ finality: "final" }),
    ]);
    const delegate = buildDelegateAction({ senderId: contributorId, receiverId: manifest.companyId, publicKey,
      nonce: accessKey.nonce + 1n, maxBlockHeight: BigInt(block.header.height) + 100n,
      actions: [actions.functionCall("claim_vested", { grant_id: grantId }, 30_000_000_000_000n, 0n)] });
    const { signedDelegate } = await signer.signDelegateAction(delegate);
    return { signedDelegateActions: [Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64")] };
  });
  await page.addInitScript(accountId => {
    const wallet = { manifest: { features: { signDelegateActions: true } }, getAccounts: async () => [{ accountId }],
      signDelegateActions: (request: unknown) => (window as unknown as { __captabLocalDelegate: (value: unknown) => Promise<unknown> }).__captabLocalDelegate(request) };
    (window as any).__CAPTAB_E2E_CONNECTOR__ = {
      getConnectedWallet: async () => ({ wallet, accounts: [{ accountId }] }), connect: async () => wallet,
    };
  }, contributorId);
  await page.goto(`/me?company=${manifest.companyId}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const card = page.getByRole("heading", { name: `Grant #${grantId}` }).locator("..");
  await expect(card.getByText("100 claimable now", { exact: false })).toBeVisible();
  await card.getByRole("button", { name: "Sponsored claim" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Sponsored claim submitted:" })).toBeVisible({ timeout: 60_000 });
  const status = await page.getByRole("status").innerText();
  const txHash = status.match(/Sponsored claim submitted: ([A-Za-z0-9]+)/)?.[1];
  if (!txHash) throw new Error("Sponsored claim transaction hash was not shown");
  await expect.poll(async () => (await view(manifest.companyId, "get_grant", { grant_id: grantId }) as { issued_units: string }).issued_units,
    { timeout: 60_000 }).toBe("100");
  console.log(JSON.stringify({ grantId, txHash, explorerUrl: `https://testnet.nearblocks.io/txns/${txHash}` }));
});
