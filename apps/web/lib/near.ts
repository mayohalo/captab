import { JsonRpcProvider } from "near-api-js";
import { assessDemoDao, type DaoAssessment, type DaoPolicy } from "./dao-policy";
import { requireTestnet } from "./network-guard.mjs";

export const network = "testnet";
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org" });
const finalBlockQuery = { finality: "final" as const };
export const assertTestnetNetwork = () => requireTestnet(provider);

export type Totals = { dao_id: string; authorized_units: string; issued_total: string; pool_available: string; grant_reserved: string; fully_diluted_total: string; unallocated_units: string; ledger_revision: number; holder_count: number };
export type CompanyConfig = { schema_version: number; dao_id: string; snapshot_operator_id: string; settlement_token_id: string;
  authorized_units: string; paused: boolean; limits: { max_holders: number; max_grants: number; max_distributions: number;
    max_actions: number; vesting_boundaries: number } };
export type CompanySnapshot = { config: CompanyConfig; totals: Totals };
export type CompanyCodeAssessment = { verified: boolean; reason: string; codeHash: string | null };
const demoLimits = { max_holders: 20, max_grants: 100, max_distributions: 20, max_actions: 200, vesting_boundaries: 49 };
export type { DaoPolicy, DaoAssessment } from "./dao-policy";
export type DaoProposal = { id: number; proposer: string; description: string; kind: Record<string, unknown>; status: string; vote_counts: Record<string, number[]> };
export type Holding = { account_id: string; issued_units: string };
export type Grant = { id: number; recipient: string; original_units: string; entitlement_cap: string; issued_units: string; vested_units: string; claimable_units: string; boundaries: number[]; cancelled_at: number | null };
export type Entitlement = { account_id: string; units: string; amount: string; payment_status: "Ready" | "InFlight" | "Failed" | "Paid" | "Zero"; attempt_id: number };
export type Distribution = { id: number; snapshot_revision: number; snapshot_timestamp: number; snapshot_block_height: number; token_id: string; budget: string; expires_at: number; schedule_hash: number[]; approved: boolean; cancelled: boolean; funded: boolean; paid_total: string; in_flight_total: string; available_escrow: string; entitlements: Entitlement[] };

const accountPattern = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export function validAccountId(id: string): boolean { return accountPattern.test(id); }

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!validAccountId(contractId)) throw new Error("Invalid NEAR account ID");
  await assertTestnetNetwork();
  const result = await provider.callFunction({ contractId, method, args, blockQuery: finalBlockQuery }) as T | undefined;
  if (result === undefined) throw new Error(`${method} returned no result`);
  return result;
}

export async function verifiedDaoPolicy(daoId: string): Promise<DaoPolicy> {
  await assertTestnetNetwork();
  const [policy, code] = await Promise.all([
    view<DaoPolicy>(daoId, "get_policy"),
    provider.viewContractCode({ contractId: daoId, blockQuery: finalBlockQuery }),
  ]);
  const assessment = assessDemoDao(policy, code.hash);
  if (!assessment.verified) throw new Error(assessment.reason);
  return policy;
}

export async function assessCompanyCode(contractId: string): Promise<CompanyCodeAssessment> {
  await assertTestnetNetwork();
  const expected = process.env.CAPTAB_COMPANY_CODE_HASH;
  if (!expected) return { verified: false, reason: "Expected company code hash is not configured.", codeHash: null };
  try {
    const code = await provider.viewContractCode({ contractId, blockQuery: finalBlockQuery });
    return code.hash === expected
      ? { verified: true, reason: "Company code matches the configured release build.", codeHash: code.hash }
      : { verified: false, reason: "Company code does not match the configured release build.", codeHash: code.hash };
  } catch {
    return { verified: false, reason: "Company code could not be verified.", codeHash: null };
  }
}

export async function verifiedCompanyCode(contractId: string): Promise<void> {
  const assessment = await assessCompanyCode(contractId);
  if (!assessment.verified) throw new Error(assessment.reason);
}

export async function readCompany(contractId: string) {
  const [company, holdings, grantPages, distributions] = await Promise.all([
    view<CompanySnapshot>(contractId, "get_company"),
    view<Holding[]>(contractId, "list_holdings", { from_index: 0, limit: 20 }),
    Promise.all([0, 20, 40, 60, 80].map(from_index => view<Grant[]>(contractId, "list_grants", { from_index, limit: 20 }))),
    view<Distribution[]>(contractId, "list_distributions", { from_index: 0, limit: 20 }),
  ]);
  const { totals, config } = company;
  if (config.schema_version !== 1 || Object.entries(demoLimits).some(([key, value]) =>
    config.limits?.[key as keyof typeof demoLimits] !== value)) {
    throw new Error("Unsupported company schema or demo limits.");
  }
  const grants = grantPages.flat();
  const companyAssessment = await assessCompanyCode(contractId);
  let daoPolicy: DaoPolicy | null = null;
  let daoAssessment: DaoAssessment = { verified: false, reason: "DAO policy could not be verified." };
  let proposals: DaoProposal[] = [];
  try {
    const [policy, lastId, code] = await Promise.all([
      view<DaoPolicy>(config.dao_id, "get_policy"),
      view<number>(config.dao_id, "get_last_proposal_id"),
      provider.viewContractCode({ contractId: config.dao_id, blockQuery: finalBlockQuery }),
    ]);
    daoPolicy = policy;
    daoAssessment = assessDemoDao(policy, code.hash);
    proposals = await view<DaoProposal[]>(config.dao_id, "get_proposals", { from_index: Math.max(0, lastId - 20), limit: 20 });
  } catch { /* Company views remain available while DAO reads are unavailable. */ }
  let treasuryBalance: string | null = null;
  try {
    const balance = await view<string>(config.settlement_token_id, "ft_balance_of", { account_id: config.dao_id });
    if (/^\d+$/.test(balance)) treasuryBalance = balance;
  } catch { /* Company and distribution views remain available if the token view fails. */ }
  return { totals, config, holdings, grants, distributions, companyAssessment, daoPolicy, daoAssessment, proposals, treasuryBalance };
}

export function formatUnits(value: string): string { return BigInt(value).toLocaleString("en-US"); }
export function percent(part: string, total: string): string {
  const denominator = BigInt(total);
  if (!denominator) return "0.00%";
  const basisPoints = (BigInt(part) * 10_000n) / denominator;
  return `${(Number(basisPoints) / 100).toFixed(2)}%`;
}
