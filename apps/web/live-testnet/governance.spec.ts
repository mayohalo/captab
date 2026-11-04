import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, actions } from "near-api-js";

type Role = "council1" | "council2";
type Request = { receiverId: string; actions: Array<{ type: string; params: {
  methodName: string; args: Record<string, unknown>; gas: string; deposit: string;
} }> };

const credentials = JSON.parse(await readFile(resolve(process.cwd(), ".data/testnet-accounts.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(process.cwd(), "../../docs/deployment-manifest.testnet.json"), "utf8"));
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });

async function view(contractId: string, method: string, args: Record<string, unknown> = {}) {
  return provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } });
}

async function attachLocalTestWallet(page: Page, role: Role) {
  const signer = credentials.accounts[role];
  await page.exposeFunction("__captabLocalSign", async (request: Request) => {
    if (request.receiverId !== manifest.daoId || request.actions.length !== 1 || request.actions[0].type !== "FunctionCall") {
      throw new Error("Local test wallet accepts one DAO call only");
    }
    const { methodName, args, gas, deposit } = request.actions[0].params;
    if (!["add_proposal", "act_proposal"].includes(methodName)) throw new Error("Unsupported test wallet action");
    const account = new Account(signer.accountId, provider, signer.privateKey);
    const outcome = await account.signAndSendTransaction({ receiverId: manifest.daoId,
      actions: [actions.functionCall(methodName, args, BigInt(gas), BigInt(deposit))], waitUntil: "FINAL" });
    return { transaction: { hash: outcome.transaction.hash }, status: outcome.status };
  });
  await page.addInitScript(accountId => {
    const wallet = { manifest: { features: { signDelegateActions: false } },
      getAccounts: async () => [{ accountId }],
      signAndSendTransaction: (request: Request) => (window as unknown as { __captabLocalSign: (value: Request) => Promise<unknown> }).__captabLocalSign(request) };
    (window as any).__CAPTAB_E2E_CONNECTOR__ = {
      getConnectedWallet: async () => ({ wallet, accounts: [{ accountId }] }), connect: async () => wallet,
    };
  }, signer.accountId);
}

async function submitAndApprove(page: Page, paused: boolean) {
  await page.goto(`/company/${manifest.companyId}/approvals`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const governance = page.locator("#governance");
  await expect(governance.getByText(`${credentials.accounts.council1.accountId} (council)`)).toBeVisible();
  await governance.getByLabel("Action").selectOption(paused ? "pause" : "resume");
  await governance.getByRole("button", { name: "Review proposal" }).click();
  await expect(governance.getByRole("heading", { name: "Review exact DAO action" })).toBeVisible({ timeout: 45_000 });
  await governance.getByRole("button", { name: "Submit to DAO" }).click();
  await expect(governance.getByRole("status")).toContainText("Confirmed in final receipts", { timeout: 60_000 });
  const lastId = Number(await view(manifest.daoId, "get_last_proposal_id"));
  const proposalId = lastId - 1;
  await page.reload();
  const proposal = governance.getByRole("heading", { name: new RegExp(`^#${proposalId} · InProgress$`) }).locator("..");
  await proposal.getByRole("button", { name: "Vote to approve" }).click();
  await expect(governance.getByRole("status")).toContainText("Confirmed in final receipts", { timeout: 60_000 });
  const second = await page.context().newPage();
  await attachLocalTestWallet(second, "council2");
  await second.goto(`/company/${manifest.companyId}/approvals`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const secondProposal = second.locator("#governance").getByRole("heading", { name: new RegExp(`^#${proposalId} · InProgress$`) }).locator("..");
  await secondProposal.getByRole("button", { name: "Vote to approve" }).click();
  await expect(second.locator("#governance").getByRole("status")).toContainText("Confirmed in final receipts", { timeout: 60_000 });
  await expect.poll(async () => (await view(manifest.daoId, "get_proposal", { id: proposalId }) as { status: string }).status).toBe("Approved");
  await expect.poll(async () => (await view(manifest.companyId, "get_config") as { paused: boolean }).paused).toBe(paused);
  await second.close();
  return proposalId;
}

test("local test wallets sign browser-driven pause and resume proposals with two council votes", async ({ page }) => {
  expect(credentials.network).toBe("testnet");
  expect(await provider.getNetworkId()).toBe("testnet");
  expect(credentials.accounts.company.accountId).toBe(manifest.companyId);
  expect(credentials.accounts.dao.accountId).toBe(manifest.daoId);
  const initial = await view(manifest.companyId, "get_config") as { paused: boolean };
  expect(initial.paused).toBe(false);
  await attachLocalTestWallet(page, "council1");
  const pauseId = await submitAndApprove(page, true);
  const resumeId = await submitAndApprove(page, false);
  console.log(JSON.stringify({ companyId: manifest.companyId, pauseProposalId: pauseId, resumeProposalId: resumeId }));
});
