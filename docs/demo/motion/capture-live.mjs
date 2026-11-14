// Captures the live captab.xyz pages and the evidence verifier's real output for the video's "it is live" act.
// Usage (from the repository root): node docs/demo/motion/capture-live.mjs
// Writes docs/demo/motion/live/{name}.png (full page, 1440 px wide at 2x), verify.txt, and meta.json.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");
const out = path.join(here, "live");
mkdirSync(out, { recursive: true });

const base = "https://captab.xyz";
const company = "/company/captab-company-0d07df99e1bb0e44.testnet";
const pages = [
  ["landing", "/"], ["overview", company], ["deals", `${company}/deals`],
  ["distributions", `${company}/distributions`], ["approvals", `${company}/approvals`],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2, colorScheme: "dark" });
const meta = { capturedAt: new Date().toISOString(), base, pages: {} };
for (const [name, route] of pages) {
  await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForLoadState("load");
  await page.waitForTimeout(2500);
  // Hide animations' mid-states: jump CSS animations to their end.
  await page.addStyleTag({ content: "*,*::before,*::after{animation-delay:-60s!important;animation-duration:.001s!important;transition:none!important}" });
  await page.waitForTimeout(300);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  // Positions of key elements (in CSS px) so the timeline can aim zooms and highlights.
  const anchors = await page.evaluate(() => {
    const pick = (sel, re) => [...document.querySelectorAll(sel)].filter(e => !re || re.test(e.textContent)).map(e => {
      const r = e.getBoundingClientRect(); return { text: e.textContent.trim().slice(0, 60), x: r.x, y: r.y + scrollY, w: r.width, h: r.height };
    });
    return {
      h2: pick("h1,h2,h3"),
      pills: pick(".pill,[class*=pill],[class*=status]", /Settled|Paid|Approved|Funded|Verified/),
    };
  });
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  meta.pages[name] = { route, height, anchors };
  console.log(`${name}: ${height}px`);
}
await browser.close();

const verify = execFileSync("node", [path.join(root, "apps/web/scripts/verify-evidence.mjs")], { encoding: "utf8", maxBuffer: 1 << 22 });
writeFileSync(path.join(out, "verify.txt"), verify);
writeFileSync(path.join(out, "verify.js"), `window.VERIFY = ${JSON.stringify(verify)};\n`);
if (!/All checks passed/.test(verify)) throw new Error("verify-evidence did not pass; refusing to capture a failing run");
meta.verifySummary = verify.trim().split("\n").at(-1);
writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));
console.log(meta.verifySummary);
