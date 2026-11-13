// Deployment profiles keep separate testnet deployments apart. With CAPTAB_DEPLOYMENT unset, scripts use
// the original (schema v1) files. CAPTAB_DEPLOYMENT=v2 uses .env.v2.local, testnet-accounts.v2.json, and
// docs/deployment-manifest.v2.testnet.json, so a second deployment never reads or overwrites the first one's keys.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const profile = process.env.CAPTAB_DEPLOYMENT ?? "";
if (profile && !/^[a-z0-9]{1,16}$/.test(profile)) throw new Error("CAPTAB_DEPLOYMENT must be 1-16 lowercase letters or digits");
const suffix = profile ? `.${profile}` : "";
export const deploymentProfile = profile || "default";
export const envPath = resolve(root, `apps/web/.env${suffix}.local`);
export const accountsPath = resolve(root, `apps/web/.data/testnet-accounts${suffix}.json`);
export const manifestPath = resolve(root, `docs/deployment-manifest${suffix}.testnet.json`);

export function loadDeploymentEnv() {
  try { process.loadEnvFile(envPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
