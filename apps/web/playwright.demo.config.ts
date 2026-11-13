import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseURL = "http://127.0.0.1:3100";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.record.ts",
  workers: 1,
  use: { baseURL, ...devices["Desktop Chrome"], colorScheme: "dark", video: "on" },
  webServer: [
    { command: "node e2e/fixture-rpc.mjs", url: "http://127.0.0.1:14555/health", reuseExistingServer: false },
    { command: "pnpm dev --port 3100", url: baseURL, reuseExistingServer: false, timeout: 120_000,
      env: { NEAR_RPC_URL: "http://127.0.0.1:14555", NEXT_PUBLIC_COMPANY_CONTRACT_ID: "company.testnet",
        NEXT_PUBLIC_CAPTAB_E2E_WALLET: "enabled", CAPTAB_DB_PATH: join(tmpdir(), `captab-demo-${randomUUID()}.sqlite`),
        CAPTAB_WORKER_SECRET: "local-demo-fixture-secret", CAPTAB_COMPANY_CODE_HASH: "fixture-company-code-hash",
        CAPTAB_AUTH_ORIGIN: baseURL } },
  ],
});
