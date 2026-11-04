import { defineConfig, devices } from "@playwright/test";

if (process.env.CAPTAB_LIVE_TESTNET !== "1") {
  throw new Error("Set CAPTAB_LIVE_TESTNET=1 to authorize the live testnet browser rehearsal");
}

const baseURL = "http://127.0.0.1:3101";
export default defineConfig({
  testDir: "./live-testnet",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 180_000,
  use: { baseURL, ...devices["Desktop Chrome"] },
  webServer: {
    command: "pnpm exec next start --port 3101",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_PUBLIC_CAPTAB_E2E_WALLET: "enabled", CAPTAB_AUTH_ORIGIN: baseURL },
  },
});
