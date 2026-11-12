import { expect, test } from "@playwright/test";

test("observation stores only a chain-recognized transaction for the selected company", async ({ request }) => {
  const endpoint = "/api/transactions/observe";
  const base = { companyId: "claimable.testnet", signerId: "alice.testnet" };
  const unknown = await request.post(endpoint, { data: { ...base, txHash: "33333333333333333333333333333333" } });
  expect(unknown.status()).toBe(502);
  const wrongSigner = await request.post(endpoint, { data: { ...base, signerId: "mallory.testnet",
    txHash: "22222222222222222222222222222222" } });
  expect(wrongSigner.status()).toBe(502);
  const known = await request.post(endpoint, { data: { ...base, txHash: "22222222222222222222222222222222" } });
  expect(known.ok()).toBeTruthy();
  expect((await known.json()).status).toBe("Confirmed");
});

test("company API audits the full ledger and reports tracked-history coverage", async ({ request }) => {
  const response = await request.get("/api/companies/company.testnet");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.audit).toEqual({ state: "Consistent", checkedRevision: 4, issues: [] });
  expect(body.chain.grants).toHaveLength(21);
  expect(body.history.coverage).toBe("app-submitted-only");
  expect(body.history.trackedCount).toBe(0);
  const worker = await request.post("/api/internal/reconcile", {
    headers: { authorization: "Bearer local-e2e-fixture-secret" },
  });
  expect(worker.ok()).toBeTruthy();
  expect((await worker.json()).audits).toContainEqual({ contractId: "company.testnet", state: "Consistent", issues: [] });
  const refreshed = await (await request.get("/api/companies/company.testnet")).json();
  expect(refreshed.history.lastWorkerAudit.state).toBe("Consistent");
  const again = await request.post("/api/internal/reconcile", {
    headers: { authorization: "Bearer local-e2e-fixture-secret" },
  });
  expect((await again.json()).audits.filter((audit: { contractId: string }) => audit.contractId === "company.testnet")).toEqual([]);
});

test("ownership and entitlement tables scroll within a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/company/company.testnet/ownership", "/company/company.testnet/distributions"]) {
    await page.goto(path);
    await expect(page.getByRole("region", { name: path.endsWith("ownership") ? "Ownership table" : "Distribution 0 entitlements" })).toBeVisible();
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(widths.page).toBeLessThanOrEqual(widths.viewport);
  }
});

test("proposal API rebuilds exact actions from current chain state", async ({ request }) => {
  const endpoint = "/api/companies/company.testnet/proposals";
  const founder = await request.post(endpoint, { data: { action: "founder", expectedRevision: 4,
    recipient: "new-founder.testnet", units: "1000" } });
  expect(founder.ok()).toBeTruthy();
  const prepared = await founder.json();
  expect(prepared.daoId).toBe("board.testnet");
  expect(prepared.proposalBond).toBe("100000000000000000000000");
  const call = prepared.proposal.kind.FunctionCall.actions[0];
  expect(call.method_name).toBe("issue_founder_units");
  expect(JSON.parse(Buffer.from(call.args, "base64").toString())).toMatchObject({
    expected_revision: 4, recipient: "new-founder.testnet", units: "1000",
  });
  const stale = await request.post(endpoint, { data: { action: "founder", expectedRevision: 3,
    recipient: "new-founder.testnet", units: "1000" } });
  expect(stale.status()).toBe(409);
  const grant = await request.post(endpoint, { data: { action: "grant", expectedRevision: 4,
    recipient: "new-contributor.testnet", units: "1000", startIso: "2025-01-31T00:00:00Z" } });
  expect(grant.ok()).toBeTruthy();
  const grantArgs = JSON.parse(Buffer.from((await grant.json()).proposal.kind.FunctionCall.actions[0].args, "base64").toString());
  expect(grantArgs.boundaries).toHaveLength(49);
  expect(new Date(grantArgs.boundaries[1] * 1000).toISOString()).toBe("2025-02-28T00:00:00.000Z");
  const closed = await request.post(endpoint, { data: { action: "fund", expectedRevision: 4, distributionId: 0 } });
  expect(closed.status()).toBe(409);
  const approval = await request.post(endpoint, { data: { action: "approve", expectedRevision: 4, distributionId: 1 } });
  expect(approval.ok()).toBeTruthy();
  expect((await approval.json()).proposal.kind.FunctionCall.actions[0].method_name).toBe("approve_distribution");
  const tampered = await request.post(endpoint, { data: { action: "approve", expectedRevision: 4, distributionId: 2 } });
  expect(tampered.status()).toBe(400);
  expect((await tampered.json()).error).toContain("schedule hash");
  const pause = await request.post(endpoint, { data: { action: "pause", expectedRevision: 4 } });
  expect(pause.ok()).toBeTruthy();
  const pauseCall = (await pause.json()).proposal.kind.FunctionCall.actions[0];
  expect(pauseCall.method_name).toBe("set_paused");
  expect(JSON.parse(Buffer.from(pauseCall.args, "base64").toString()).paused).toBe(true);
  const cancellation = await request.post(endpoint, { data: { action: "cancelDistribution", expectedRevision: 4, distributionId: 1 } });
  expect(cancellation.ok()).toBeTruthy();
  expect((await cancellation.json()).proposal.kind.FunctionCall.actions[0].method_name).toBe("cancel_unfunded_distribution");
  expect((await request.post(endpoint, { data: { action: "cancelDistribution", expectedRevision: 4, distributionId: 0 } })).status()).toBe(409);
  const pausedEndpoint = "/api/companies/paused.testnet/proposals";
  const resume = await request.post(pausedEndpoint, { data: { action: "resume", expectedRevision: 4 } });
  expect(resume.ok()).toBeTruthy();
  const resumeCall = (await resume.json()).proposal.kind.FunctionCall.actions[0];
  expect(JSON.parse(Buffer.from(resumeCall.args, "base64").toString()).paused).toBe(false);
  expect((await request.post(pausedEndpoint, { data: { action: "founder", expectedRevision: 4,
    recipient: "new-founder.testnet", units: "1" } })).status()).toBe(409);
  const unsafe = await request.post("/api/companies/unsafe.testnet/proposals", { data: { action: "pool", expectedRevision: 4, units: "1" } });
  expect(unsafe.ok()).toBeFalsy();
  const altered = await request.post("/api/companies/altered.testnet/proposals", { data: { action: "pool", expectedRevision: 4, units: "1" } });
  expect(altered.status()).toBe(502);
  expect((await altered.json()).error).toContain("Company code does not match");
});

test("setup inspects the configured company, DAO, and settlement token", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CapTable" })).toBeVisible();
  await page.getByRole("link", { name: "Inspect or deploy a company" }).click();
  await page.getByLabel("Company contract account").fill("company.testnet");
  await page.getByRole("button", { name: "Inspect on-chain setup" }).click();
  await expect(page.getByRole("heading", { name: "Company contract" })).toBeVisible();
  await expect(page.getByText(/Schema v1 · limits 20 holders, 100 grants, 20 distributions, 200 actions/)).toBeVisible();
  await expect(page.getByText("Council accounts: 3 · approvals required: 2 of 3")).toBeVisible();
  await expect(page.getByText("Pinned Sputnik code and 2 of 3 council approval verified.")).toBeVisible();
  await expect(page.getByText("TESTUSD · 6 decimals")).toBeVisible();
  await page.getByRole("link", { name: "Open company governance" }).click();
  await expect(page.getByRole("heading", { name: "Ownership" })).toBeVisible();
});

test("setup rejects an unsupported company schema", async ({ page }) => {
  await page.goto("/setup?company=legacy.testnet");
  await expect(page.getByText("Unsupported company schema or demo limits.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open company governance" })).toHaveCount(0);
});

test("altered company code keeps the ledger readable but disables governance", async ({ page }) => {
  await page.goto("/company/altered.testnet");
  await expect(page.getByRole("heading", { name: "Ownership" })).toBeVisible();
  await expect(page.getByText(/Company verification failed: Company code does not match/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Review proposal" })).toHaveCount(0);
});

test("altered company code is rejected by payout and sponsor APIs", async ({ request }) => {
  const payout = await request.post("/api/distributions/0/execute", {
    headers: { authorization: "Bearer local-e2e-fixture-secret" }, data: { companyId: "altered.testnet" },
  });
  expect(payout.status()).toBe(409);
  expect((await payout.json()).error).toContain("Company code does not match");
  const sponsor = await request.post("/api/sponsor", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { companyId: "altered.testnet", signedDelegate: "signed-request" },
  });
  expect(sponsor.status()).toBe(409);
  expect((await sponsor.json()).error).toContain("Company code does not match");
});

test("ownership, vesting, and a failed payout render from chain views", async ({ page }) => {
  await page.goto("/company/company.testnet");
  await expect(page.getByText(/DAO treasury board\.testnet: 90,000,000,000 token base units/)).toBeVisible();
  await expect(page.getByText("6,025,000")).toBeVisible();
  await expect(page.getByText("8,000,000")).toBeVisible();
  await expect(page.getByRole("row", { name: /founder-a\.testnet.*3,600,000/ })).toBeVisible();
  await expect(page.getByText("Claimable 0 · remaining reservation 75,000")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Grant #20" })).toBeVisible();
  await expect(page.getByRole("row", { name: /contributor\.testnet.*41,493,776.*Failed/ })).toBeVisible();
  await expect(page.getByText("contributor.testnet · 41493776 · Failed · attempt 1")).toBeVisible();
});

test("dedicated company workflow routes open ledger, grant, approval, and distribution details", async ({ page }) => {
  await page.goto("/company/company.testnet");
  await page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Ownership", exact: true }).click();
  await expect(page).toHaveURL(/\/company\/company\.testnet\/ownership$/);
  await expect(page.getByRole("heading", { name: "Ownership", level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Grants" }).click();
  await expect(page.getByRole("heading", { name: "Grants", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Grant #20" }).click();
  await expect(page.getByRole("heading", { name: "Grant #20", level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Approvals" }).click();
  await expect(page.getByRole("heading", { name: "Approvals", level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Distributions" }).click();
  await expect(page.getByRole("heading", { name: "Distributions", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Distribution #0" }).click();
  await expect(page.getByRole("heading", { name: "Distribution #0", level: 1 })).toBeVisible();
});

test("governance review binds a founder action to the current revision", async ({ page }) => {
  await page.goto("/company/company.testnet");
  const governance = page.locator("#governance");
  await governance.getByLabel("Recipient account").fill("new-founder.testnet");
  await governance.getByRole("textbox", { name: "Units", exact: true }).fill("2000001");
  await governance.getByRole("button", { name: "Review proposal" }).click();
  await expect(governance.getByRole("status")).toHaveText("Units exceed unallocated capacity.");
  await governance.getByRole("textbox", { name: "Units", exact: true }).fill("1000");
  await governance.getByRole("button", { name: "Review proposal" }).click();
  await expect(governance.getByRole("heading", { name: "Review exact DAO action" })).toBeVisible();
  await expect(governance.locator("pre").first()).toContainText('"method_name": "issue_founder_units"');
  await expect(governance.locator("pre").first()).toContainText('"expected_revision": 4');
  await expect(governance.getByRole("button", { name: "Submit to DAO" })).toBeDisabled();
});

test("paused company can review an exact DAO resume action", async ({ page }) => {
  await page.goto("/company/paused.testnet/approvals");
  const governance = page.locator("#governance");
  await governance.getByLabel("Action").selectOption("resume");
  await governance.getByRole("button", { name: "Review proposal" }).click();
  const review = governance.locator("article").first();
  await expect(review.locator("pre")).toContainText('"method_name": "set_paused"');
  await expect(review.locator("pre")).toContainText('"paused": false');
});

test("connected council wallet signs reviewed proposal and vote requests", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __CAPTAB_E2E_CONNECTOR__?: unknown; __captabWalletCalls?: unknown[] };
    state.__captabWalletCalls = [];
    const account = { accountId: "council-a.testnet" };
    const wallet = { manifest: { features: { signDelegateActions: false } }, getAccounts: async () => [account],
      signAndSendTransaction: async (request: unknown) => {
        state.__captabWalletCalls!.push(request);
        return { transaction: { hash: `fixture-signed-${state.__captabWalletCalls!.length}` }, status: { SuccessValue: "" } };
      } };
    state.__CAPTAB_E2E_CONNECTOR__ = { getConnectedWallet: async () => ({ wallet, accounts: [account] }), connect: async () => wallet };
  });
  await page.route("**/api/transactions/observe", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ operationId: "fixture-operation", status: "Confirmed" }) }));
  await page.goto("/company/company.testnet/approvals");
  const governance = page.locator("#governance");
  await expect(governance.getByText("council-a.testnet (council)")).toBeVisible();
  await governance.getByLabel("Recipient account").fill("new-founder.testnet");
  await governance.getByRole("textbox", { name: "Units", exact: true }).fill("100");
  await governance.getByRole("button", { name: "Review proposal" }).click();
  await governance.getByRole("button", { name: "Submit to DAO" }).click();
  await expect(governance.getByRole("status")).toContainText("Proposal submitted: fixture-signed-1");
  await expect(governance.getByRole("status")).toContainText("Confirmed in final receipts");
  await expect(governance.getByRole("status")).toContainText("Board votes and company execution remain separate");
  await governance.getByRole("button", { name: "Vote to approve" }).click();
  await expect(governance.getByRole("status")).toContainText("Vote transaction fixture-signed-2");
  const calls = await page.evaluate(() => (window as typeof window & { __captabWalletCalls?: unknown[] }).__captabWalletCalls);
  expect(calls).toHaveLength(2);
  expect(calls?.[0]).toMatchObject({ receiverId: "board.testnet", actions: [{ params: { methodName: "add_proposal",
    args: { proposal: { kind: { FunctionCall: { receiver_id: "company.testnet" } } } } } }] });
  expect(calls?.[1]).toMatchObject({ receiverId: "board.testnet", actions: [{ params: { methodName: "act_proposal",
    args: { id: 0, action: "VoteApprove" } } }] });
});

test("contributor wallet signs a vested claim for its own account", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __CAPTAB_E2E_CONNECTOR__?: unknown; __captabWalletCalls?: unknown[] };
    state.__captabWalletCalls = [];
    const account = { accountId: "contributor.testnet" };
    const wallet = { manifest: { features: { signDelegateActions: false } }, getAccounts: async () => [account],
      signAndSendTransaction: async (request: unknown) => {
        state.__captabWalletCalls!.push(request);
        return { transaction: { hash: "fixture-claim-signed" }, status: { SuccessValue: "" } };
      } };
    state.__CAPTAB_E2E_CONNECTOR__ = { getConnectedWallet: async () => ({ wallet, accounts: [account] }), connect: async () => wallet };
  });
  await page.route("**/api/transactions/observe", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ operationId: "fixture-claim-operation", status: "Confirmed" }) }));
  await page.goto("/me?company=claimable.testnet");
  await expect(page.getByText("25 claimable now")).toBeVisible();
  await page.getByRole("button", { name: "Claim with wallet gas" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Claim transaction fixture-claim-signed" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Confirmed in final receipts");
  const calls = await page.evaluate(() => (window as typeof window & { __captabWalletCalls?: unknown[] }).__captabWalletCalls);
  expect(calls).toEqual([{ receiverId: "claimable.testnet", actions: [{ type: "FunctionCall", params: {
    methodName: "claim_vested", args: { grant_id: 0 }, gas: "30000000000000", deposit: "0",
  } }] }]);
});

test("snapshot operator wallet signs an immutable distribution preparation", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __CAPTAB_E2E_CONNECTOR__?: unknown; __captabWalletCalls?: unknown[] };
    state.__captabWalletCalls = [];
    const account = { accountId: "operator.testnet" };
    const wallet = { manifest: { features: { signDelegateActions: false } }, getAccounts: async () => [account],
      signAndSendTransaction: async (request: unknown) => {
        state.__captabWalletCalls!.push(request);
        return { transaction: { hash: "fixture-snapshot-signed" }, status: { SuccessValue: "" } };
      } };
    state.__CAPTAB_E2E_CONNECTOR__ = { getConnectedWallet: async () => ({ wallet, accounts: [account] }), connect: async () => wallet };
  });
  await page.route("**/api/transactions/observe", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ operationId: "fixture-snapshot-operation", status: "Pending" }) }));
  await page.goto("/company/company.testnet/distributions");
  const execution = page.locator("#distribution-actions");
  await execution.getByLabel("Budget in token base units").fill("1000");
  await execution.getByLabel("Expiry in UTC (ISO 8601)").fill("2035-01-01T00:00:00Z");
  await execution.getByRole("button", { name: "Create immutable snapshot" }).click();
  await expect(execution.getByRole("status")).toContainText("Transaction fixture-snapshot-signed");
  await expect(execution.getByRole("status")).toContainText("Executing: waiting for final receipts");
  const calls = await page.evaluate(() => (window as typeof window & { __captabWalletCalls?: unknown[] }).__captabWalletCalls);
  expect(calls).toEqual([{ receiverId: "company.testnet", actions: [{ type: "FunctionCall", params: {
    methodName: "prepare_distribution", args: { expected_revision: 4, budget: "1000", expires_at: 2_051_222_400 },
    gas: "100000000000000", deposit: "0",
  } }] }]);
});

test("grant card reports a failed wallet claim without observing it as submitted", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __CAPTAB_E2E_CONNECTOR__?: unknown };
    const account = { accountId: "contributor.testnet" };
    const wallet = { manifest: { features: { signDelegateActions: false } }, getAccounts: async () => [account],
      signAndSendTransaction: async () => ({ transaction: { hash: "failed-claim" }, status: { Failure: { ActionError: "fixture" } } }) };
    state.__CAPTAB_E2E_CONNECTOR__ = { getConnectedWallet: async () => ({ wallet, accounts: [account] }), connect: async () => wallet };
  });
  let observations = 0;
  await page.route("**/api/transactions/observe", route => { observations++; return route.fulfill({ status: 200, body: "{}" }); });
  await page.goto("/company/claimable.testnet/grants/0");
  await page.getByRole("button", { name: "Claim vested units" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Claim failed" })).toBeVisible();
  expect(observations).toBe(0);
});

test("personal ownership has a safe disconnected state", async ({ page }) => {
  await page.goto("/me?company=company.testnet");
  await expect(page.getByRole("heading", { name: "My ownership" })).toBeVisible();
  await expect(page.getByText("Connect the NEAR account that holds your units or grants.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
});

test("unverified DAO code cannot enable governance controls", async ({ page }) => {
  await page.goto("/company/unsafe.testnet");
  await expect(page.getByRole("alert").filter({ hasText: "DAO verification failed" })).toBeVisible();
  await expect(page.locator("#governance").getByRole("button", { name: "Review proposal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Queue ready and failed recipients" })).toBeDisabled();
});

test("cap table export reconciles to the ledger in CSV and JSON", async ({ request }) => {
  const csv = await request.get("/api/companies/company.testnet/export?format=csv");
  expect(csv.ok()).toBeTruthy();
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["x-captab-ledger-revision"]).toBe("4");
  const body = await csv.text();
  const { createHash } = await import("node:crypto");
  expect(csv.headers()["x-captab-export-sha256"]).toBe(createHash("sha256").update(body).digest("hex"));
  expect(body).toContain("holding,founder-a.testnet,3600000,59.7510,45.0000,");
  expect(body).toContain("pool_available,,1900000,,23.7500,");
  const json = await (await request.get("/api/companies/company.testnet/export?format=json")).json();
  expect(json.totals).toMatchObject({ issuedUnits: "6025000", fullyDilutedUnits: "8000000" });
  expect(json.grants).toHaveLength(21);
  expect((await request.get("/api/companies/company.testnet/export?format=xlsx")).status()).toBe(400);
});

test("ownership page models a priced round without proposing anything", async ({ page }) => {
  await page.goto("/company/company.testnet/ownership");
  await expect(page.getByRole("link", { name: "CSV" })).toHaveAttribute("href", "/api/companies/company.testnet/export?format=csv");
  await expect(page.getByTestId("round-summary")).toContainText("Post-money $10,000,000.00 · price per unit $1.000000");
  await expect(page.getByTestId("round-summary")).toContainText("new investor units 2,000,000");
  await page.getByLabel("Available pool after the round (% of fully diluted)").fill("25");
  await expect(page.getByTestId("round-summary")).toContainText("pool top-up 872,727");
  await expect(page.getByText(/authorized units would have to increase/)).toBeVisible();
});

test("distributions page previews an exit waterfall with a preference", async ({ page }) => {
  await page.goto("/company/company.testnet/distributions");
  await expect(page.getByTestId("waterfall-total")).toHaveText("$10,000,000.00");
  await page.getByRole("button", { name: "Add liquidation preference" }).click();
  const table = page.getByRole("region", { name: "Exit waterfall table" });
  await expect(table.getByRole("row", { name: /contributor\.testnet/ })).toContainText("Preference $2,000,000.00");
  await expect(page.getByTestId("waterfall-total")).toHaveText("$10,000,000.00");
});

const decodeArgs = (proposal: { kind: { FunctionCall: { receiver_id: string; actions: { method_name: string; args: string; gas: string; deposit: string }[] } } }) => {
  const action = proposal.kind.FunctionCall.actions[0];
  return { receiver: proposal.kind.FunctionCall.receiver_id, method: action.method_name, deposit: action.deposit,
    args: JSON.parse(Buffer.from(action.args, "base64").toString()) };
};

test("v2 company audit reconciles deals, locked units, and reserved investor units", async ({ request }) => {
  const body = await (await request.get("/api/companies/v2.testnet")).json();
  expect(body.audit).toEqual({ state: "Consistent", checkedRevision: 9, issues: [] });
  expect(body.chain.deals).toHaveLength(4);
  expect(body.chain.rounds[0].id).toBe("seed");
  const csv = await (await request.get("/api/companies/v2.testnet/export?format=csv")).text();
  expect(csv).toContain("reserved_for_investors,,250000,");
  const json = await (await request.get("/api/companies/v2.testnet/export?format=json")).json();
  expect(json.schemaVersion).toBe(2);
  expect(json.holders.find((holder: { accountId: string }) => holder.accountId === "founder-b.testnet").lockedUnits).toBe("100000");
});

test("proposal API builds v2 board actions and refuses them for a v1 company", async ({ request }) => {
  const post = (company: string, data: Record<string, unknown>) =>
    request.post(`/api/companies/${company}/proposals`, { data: { expectedRevision: company === "v2.testnet" ? 9 : 4, ...data } });
  const doc = "b".repeat(64);
  const issue = await post("v2.testnet", { action: "approveDeal", dealKind: "Issue", roundId: "seed", buyer: "fund.testnet", units: "1000", docHash: doc });
  expect(issue.ok()).toBeTruthy();
  const issueCall = decodeArgs((await issue.json()).proposal);
  expect(issueCall.method).toBe("approve_deal");
  expect(issueCall.args.terms).toMatchObject({ kind: "Issue", buyer: "fund.testnet", units: "1000", price: "1000000000", round_id: "seed", doc_hash: doc });

  const payouts = [{ account_id: "founder-a.testnet", amount: "700" }, { account_id: "contributor.testnet", amount: "300" }];
  const explicit = decodeArgs((await (await post("v2.testnet", { action: "explicitDistribution", payouts, label: "exit" })).json()).proposal);
  expect(explicit.method).toBe("prepare_explicit_distribution");
  expect(explicit.args).toMatchObject({ expected_revision: 9, budget: "1000", payouts, label: "exit", doc_hash: null });

  const buyback = decodeArgs((await (await post("v2.testnet", { action: "approveDeal", dealKind: "Buyback", seller: "founder-a.testnet",
    units: "10", price: "5000" })).json()).proposal);
  expect(buyback.args.terms).toMatchObject({ kind: "Buyback", seller: "founder-a.testnet", units: "10", price: "5000" });
  expect(buyback.args.terms.buyer).toBeUndefined();

  const grant = decodeArgs((await (await post("v2.testnet", { action: "grant", recipient: "cofounder.testnet", units: "500",
    startIso: "2026-01-01T00:00:00Z", scheduleMonths: 24, cliffMonths: 6, source: "unallocated", docHash: doc })).json()).proposal);
  expect(grant.args.boundaries).toHaveLength(25);
  expect(grant.args.terms).toEqual({ cliff_index: 6, source: "Unallocated" });

  const authorized = decodeArgs((await (await post("v2.testnet", { action: "increaseAuthorized", authorizedUnits: "20000000" })).json()).proposal);
  expect(authorized.args).toMatchObject({ authorized_units: "20000000", expected_revision: 9 });

  const pay = await post("v2.testnet", { action: "payBuyback", dealId: 1 });
  expect(pay.status()).toBe(409);
  expect((await pay.json()).error).toContain("Only an accepted buyback");
  const cancel = decodeArgs((await (await post("v2.testnet", { action: "cancelDeal", dealId: 2 })).json()).proposal);
  expect(cancel).toMatchObject({ method: "cancel_deal", args: { deal_id: 2 } });

  expect((await post("v2.testnet", { action: "approveDeal", dealKind: "Issue", roundId: "seed", buyer: "fund.testnet", units: "1250001" })).status()).toBe(409);
  expect((await post("v2.testnet", { action: "pool", units: "1", docHash: "NOT-A-HASH" })).status()).toBe(400);
  const v1 = await post("company.testnet", { action: "approveDeal", dealKind: "Issue", roundId: "seed", buyer: "fund.testnet", units: "1" });
  expect(v1.status()).toBe(400);
  expect((await v1.json()).error).toContain("schema v2");
  const v1Founder = decodeArgs((await (await post("company.testnet", { action: "founder", recipient: "new.testnet", units: "1" })).json()).proposal);
  expect(Object.keys(v1Founder.args)).toEqual(["action_id", "expected_revision", "recipient", "units"]);
});

test("deals page shows rounds and deal states, and a buyer pays the token contract", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __CAPTAB_E2E_CONNECTOR__?: unknown; __captabWalletCalls?: unknown[] };
    state.__captabWalletCalls = [];
    const account = { accountId: "angel.testnet" };
    const wallet = { manifest: { features: { signDelegateActions: false } }, getAccounts: async () => [account],
      signAndSendTransaction: async (request: unknown) => {
        state.__captabWalletCalls!.push(request);
        return { transaction: { hash: "fixture-deal-payment" }, status: { SuccessValue: "" } };
      } };
    state.__CAPTAB_E2E_CONNECTOR__ = { getConnectedWallet: async () => ({ wallet, accounts: [account] }), connect: async () => wallet };
  });
  await page.goto("/company/v2.testnet/deals");
  await expect(page.getByRole("region", { name: "Rounds table" })).toContainText("seed");
  await expect(page.getByTestId("deal-1")).toContainText("Secondary sale · Accepted");
  await expect(page.getByTestId("deal-3")).toContainText("10000000 held");
  await expect(page.getByTestId("deal-2").getByRole("button")).toHaveCount(0);
  await page.getByTestId("deal-1").getByRole("button", { name: "Pay with the settlement token" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Payment fixture-deal-payment sent" })).toBeVisible();
  const calls = await page.evaluate(() => (window as typeof window & { __captabWalletCalls?: unknown[] }).__captabWalletCalls);
  expect(calls).toEqual([{ receiverId: "testusd.testnet", actions: [{ type: "FunctionCall", params: {
    methodName: "ft_transfer_call", args: { receiver_id: "v2.testnet", amount: "90000000000", msg: "{\"deal_id\":1}" },
    gas: "150000000000000", deposit: "1" } }] }]);
});

test("v2 exit preview produces payout lines in token base units", async ({ page }) => {
  await page.goto("/company/v2.testnet/distributions");
  await expect(page.getByTestId("waterfall-total")).toHaveText("$10,000,000.00");
  const lines = (await page.getByTestId("waterfall-payouts").inputValue()).split("\n");
  expect(lines).toContain("founder-a.testnet 5454545450000");
  const total = lines.reduce((sum, line) => sum + BigInt(line.split(" ")[1]), 0n);
  expect(total).toBe(10_000_000_000_000n);
  await page.goto("/company/v2.testnet/approvals");
  await page.getByLabel("Action").selectOption("explicitDistribution");
  await expect(page.getByLabel(/Payouts, one "account amount" per line/)).toBeVisible();
});
