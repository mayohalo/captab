import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  use: { baseURL, ...devices["Desktop Chrome"] },
  webServer: [
    { command: "node e2e/fixture-rpc.mjs", url: "http://127.0.0.1:14555/health", reuseExistingServer: false },
    { command: "pnpm dev --port 3100", url: baseURL, reuseExistingServer: false, timeout: 120_000,
      env: { NEAR_RPC_URL: "http://127.0.0.1:14555", NEXT_PUBLIC_COMPANY_CONTRACT_ID: "company.testnet" } },
  ],
});
