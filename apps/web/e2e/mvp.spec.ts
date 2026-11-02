import { expect, test } from "@playwright/test";

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
  expect((await worker.json()).audits).toEqual([{ contractId: "company.testnet", state: "Consistent", issues: [] }]);
  const refreshed = await (await request.get("/api/companies/company.testnet")).json();
  expect(refreshed.history.lastWorkerAudit.state).toBe("Consistent");
  const again = await request.post("/api/internal/reconcile", {
    headers: { authorization: "Bearer local-e2e-fixture-secret" },
  });
  expect((await again.json()).audits).toEqual([]);
});

test("setup inspects the configured company, DAO, and settlement token", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CapTable" })).toBeVisible();
  await page.getByRole("link", { name: "Inspect or deploy a company" }).click();
  await page.getByLabel("Company contract account").fill("company.testnet");
  await page.getByRole("button", { name: "Inspect on-chain setup" }).click();
  await expect(page.getByRole("heading", { name: "Company contract" })).toBeVisible();
  await expect(page.getByText("Council accounts: 3 (expected)")).toBeVisible();
  await expect(page.getByText("Pinned Sputnik code and two-of-three council policy verified.")).toBeVisible();
  await expect(page.getByText("TESTUSD · 6 decimals")).toBeVisible();
  await page.getByRole("link", { name: "Open company governance" }).click();
  await expect(page.getByRole("heading", { name: "Ownership" })).toBeVisible();
});

test("ownership, vesting, and a failed payout render from chain views", async ({ page }) => {
  await page.goto("/company/company.testnet");
  await expect(page.getByText("6,025,000")).toBeVisible();
  await expect(page.getByText("8,000,000")).toBeVisible();
  await expect(page.getByRole("row", { name: /founder-a\.testnet.*3,600,000/ })).toBeVisible();
  await expect(page.getByText("Claimable 0 · remaining reservation 75,000")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Grant #20" })).toBeVisible();
  await expect(page.getByRole("row", { name: /contributor\.testnet.*41,493,776.*Failed/ })).toBeVisible();
  await expect(page.getByText("contributor.testnet · 41493776 · Failed · attempt 1")).toBeVisible();
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
  await expect(governance.locator("pre")).toContainText('"method_name": "issue_founder_units"');
  await expect(governance.locator("pre")).toContainText('"expected_revision": 4');
  await expect(governance.getByRole("button", { name: "Submit to DAO" })).toBeDisabled();
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
