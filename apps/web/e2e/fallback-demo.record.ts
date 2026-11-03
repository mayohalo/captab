import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const output = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/demo");

test("record fixture-backed fallback walkthrough", async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(output, { recursive: true });
  async function capture(path: string, heading: string, filename: string) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible();
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.append(style);
      const notice = document.createElement("div");
      notice.textContent = "FIXTURE WALKTHROUGH · NO LIVE TESTNET SIGNATURES";
      notice.style.cssText = "padding:8px 14px;background:#14251f;color:white;font:700 13px Arial,sans-serif;text-align:center";
      document.body.prepend(notice);
    });
    await page.screenshot({ path: resolve(output, filename), fullPage: true });
    await page.waitForTimeout(1_000);
  }
  await capture("/setup?company=company.testnet", "Company setup", "setup.png");
  await capture("/company/company.testnet/ownership", "Ownership", "ownership.png");
  await capture("/company/company.testnet/grants", "Grants", "grants.png");
  await capture("/company/company.testnet/approvals", "Approvals", "approvals.png");
  await capture("/company/company.testnet/distributions", "Distributions", "distributions.png");
  await capture("/me?company=claimable.testnet", "My ownership", "personal.png");
  const video = page.video();
  if (!video) throw new Error("Fallback walkthrough video was not recorded");
  await page.close();
  await video.saveAs(resolve(output, "fixture-walkthrough.webm"));
});
