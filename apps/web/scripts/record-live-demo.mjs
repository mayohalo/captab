import { readFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(await readFile(resolve(root, "docs/deployment-manifest.testnet.json"), "utf8"));
const baseURL = process.env.CAPTAB_BASE_URL ?? "http://127.0.0.1:3000";
const output = resolve(root, "docs/demo/live-testnet.webm");
await mkdir(dirname(output), { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    recordVideo: { dir: resolve(root, "apps/web/.data"), size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  const screens = [
    [`/setup?company=${manifest.companyId}`, "Company setup"],
    [`/company/${manifest.companyId}/ownership`, "Ownership"],
    [`/company/${manifest.companyId}/grants`, "Grants"],
    [`/company/${manifest.companyId}/approvals`, "Approvals"],
    [`/company/${manifest.companyId}/distributions`, "Distributions"],
    [`/company/${manifest.companyId}/activity`, "Activity"],
  ];
  for (const [path, heading] of screens) {
    const response = await page.goto(new URL(path, baseURL).toString(), { waitUntil: "domcontentloaded", timeout: 90_000 });
    if (!response?.ok()) throw new Error(`${path} returned HTTP ${response?.status() ?? "unknown"}`);
    await page.getByRole("heading", { name: heading, exact: true, level: 1 }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
  }
  await context.close();
  await page.video()?.saveAs(output);
  console.log(JSON.stringify({ video: output, companyId: manifest.companyId, screens: screens.length }));
} finally { await browser.close(); }
