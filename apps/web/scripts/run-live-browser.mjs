import { spawnSync } from "node:child_process";

if (process.env.CAPTAB_LIVE_TESTNET !== "1") {
  throw new Error("Set CAPTAB_LIVE_TESTNET=1 before running the live browser testnet rehearsal");
}

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const buildEnv = { ...process.env, NEXT_PUBLIC_CAPTAB_E2E_WALLET: "enabled" };
const releaseEnv = { ...process.env };
delete releaseEnv.NEXT_PUBLIC_CAPTAB_E2E_WALLET;
let status = 1;
const testArgs = process.argv.slice(2).filter(argument => argument !== "--");
try {
  if (run("pnpm", ["build"], buildEnv) === 0) {
    status = run("pnpm", ["exec", "playwright", "test", "--config", "playwright.live.config.ts", ...testArgs], buildEnv);
  }
} finally {
  // The test adapter is compiled into the temporary local browser build only.
  const releaseBuildStatus = run("pnpm", ["build"], releaseEnv);
  if (releaseBuildStatus !== 0) status = releaseBuildStatus;
}
process.exitCode = status;
