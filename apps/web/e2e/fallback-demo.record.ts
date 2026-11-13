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
      notice.style.cssText = "padding:7px 14px;background:#151E29;color:#F5B54A;border-bottom:1px solid #223040;font:700 12px -apple-system,Arial,sans-serif;letter-spacing:.08em;text-align:center";
      document.body.prepend(notice);
    });
    await page.waitForTimeout(1_800); // let the logo animation finish
    await page.screenshot({ path: resolve(output, filename), fullPage: true });
    await page.waitForTimeout(1_000);
  }
  await capture("/", "Captab", "home.png");
  await capture("/company/v2.testnet", "v2.testnet", "overview.png");
  await capture("/setup?company=company.testnet", "Company setup", "setup.png");
  await capture("/company/company.testnet/ownership", "Ownership", "ownership.png");
  await capture("/company/company.testnet/grants", "Grants", "grants.png");
  await capture("/company/company.testnet/approvals", "Approvals", "approvals.png");
  await capture("/company/company.testnet/distributions", "Distributions", "distributions.png");
  await capture("/company/v2.testnet/deals", "Deals", "deals.png");
  await capture("/me?company=claimable.testnet", "My ownership", "personal.png");
  const video = page.video();
  if (!video) throw new Error("Fallback walkthrough video was not recorded");
  await page.close();
  await video.saveAs(resolve(output, "fixture-walkthrough.webm"));
});
