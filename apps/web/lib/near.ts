import { JsonRpcProvider } from "near-api-js";
import { assessDaoPolicy, type DaoAssessment, type DaoPolicy } from "./dao-policy";
import { requireTestnet } from "./network-guard.mjs";
import { isV2, supportedSchema } from "./schema.mjs";

export const network = "testnet";
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com" });
const finalBlockQuery = { finality: "final" as const };
export const assertTestnetNetwork = () => requireTestnet(provider);

export type Totals = { dao_id: string; authorized_units: string; issued_total: string; pool_available: string; grant_reserved: string;
  /** Schema v2: units reserved by approved, unsettled investor issuance deals. */
  deal_reserved?: string; fully_diluted_total: string; unallocated_units: string; ledger_revision: number; holder_count: number };
export type CompanyLimits = { max_holders: number; max_grants: number; max_distributions: number; max_actions: number | null;
  vesting_boundaries: number; max_deals?: number; max_rounds?: number; max_payout_rows?: number; max_vesting_boundaries?: number };
export type CompanyConfig = { schema_version: number; dao_id: string; snapshot_operator_id: string; settlement_token_id: string;
  authorized_units: string; paused: boolean; closed?: boolean; limits: CompanyLimits };
export type CompanySnapshot = { config: CompanyConfig; totals: Totals };
export type CompanyCodeAssessment = { verified: boolean; reason: string; codeHash: string | null };
export { LIMITS_BY_SCHEMA, isV2, supportedSchema } from "./schema.mjs";
export type { DaoPolicy, DaoAssessment } from "./dao-policy";
export type DaoProposal = { id: number; proposer: string; description: string; kind: Record<string, unknown>; status: string; vote_counts: Record<string, number[]> };
export type Holding = { account_id: string; issued_units: string; locked_units?: string };
export type Grant = { id: number; recipient: string; original_units: string; entitlement_cap: string; issued_units: string; vested_units: string; claimable_units: string; boundaries: number[]; cancelled_at: number | null;
  cliff_index?: number; source?: "Pool" | "Unallocated"; accelerated_months?: number; doc_hash?: string | null; accepted_terms_hash?: string | null };
export type Entitlement = { account_id: string; units: string; amount: string; payment_status: "Ready" | "InFlight" | "Failed" | "Paid" | "Zero"; attempt_id: number };
export type Distribution = { id: number; kind?: "ProRata" | "Explicit"; label?: string | null; doc_hash?: string | null; snapshot_revision: number; snapshot_timestamp: number; snapshot_block_height: number; token_id: string; budget: string; expires_at: number; schedule_hash: number[]; approved: boolean; cancelled: boolean; funded: boolean; paid_total: string; in_flight_total: string; available_escrow: string; entitlements: Entitlement[] };

export type DealKind = "Issue" | "Secondary" | "Buyback";
export type DealStatus = "Approved" | "Accepted" | "Settled" | "Cancelled";
export type Deal = { id: number; kind: DealKind; seller: string | null; buyer: string | null; units: string; price: string; expires_at: number;
  round_id: string | null; doc_hash: string | null; status: DealStatus; settled_at: number | null; proceeds_recipient: string;
  proceeds_pending: string; forward_attempt: number; forward_in_flight: boolean };
export type Round = { id: string; price_per_unit: string; doc_hash: string | null; opened_at: number; closed_at: number | null;
  units_issued: string; amount_raised: string; deal_count: number };

/** Cliff and end of a grant's schedule; v1 grants always use a 12-month cliff over 48 months. */
export function grantMilestones(grant: Grant) {
  const cliffIndex = grant.cliff_index ?? 12;
  return { cliffIndex, months: grant.boundaries.length - 1, start: grant.boundaries[0],
    cliff: grant.boundaries[cliffIndex], end: grant.boundaries[grant.boundaries.length - 1] };
}

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
  const assessment = assessDaoPolicy(policy, code.hash);
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

/** Reads pages in order and stops at the first short page, so a small company costs one RPC call per list. */
async function readPages<T>(read: (fromIndex: number) => Promise<T[]>, size: number, max: number): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += size) {
    const page = await read(from);
    rows.push(...page);
    if (page.length < size) break;
  }
  return rows;
}

export async function readCompany(contractId: string) {
  const company = await view<CompanySnapshot>(contractId, "get_company");
  const { totals, config } = company;
  if (!supportedSchema(config)) throw new Error("Unsupported company schema or demo limits.");
  const v2 = isV2(config);
  // v2 distributions carry up to 100 rows each, so they are read five at a time to stay within view gas.
  const distributionPage = v2 ? 5 : 20;
  const [holdings, grants, distributions, deals, rounds] = await Promise.all([
    view<Holding[]>(contractId, "list_holdings", { from_index: 0, limit: config.limits.max_holders }),
    readPages(from_index => view<Grant[]>(contractId, "list_grants", { from_index, limit: 20 }), 20, config.limits.max_grants),
    readPages(from_index => view<Distribution[]>(contractId, "list_distributions", { from_index, limit: distributionPage }),
      distributionPage, config.limits.max_distributions),
    v2 ? readPages(from_index => view<Deal[]>(contractId, "list_deals", { from_index, limit: 50 }), 50, config.limits.max_deals ?? 0)
      : Promise.resolve([] as Deal[]),
    v2 ? view<Round[]>(contractId, "list_rounds") : Promise.resolve([] as Round[]),
  ]);
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
    daoAssessment = assessDaoPolicy(policy, code.hash);
    proposals = await view<DaoProposal[]>(config.dao_id, "get_proposals", { from_index: Math.max(0, lastId - 20), limit: 20 });
  } catch { /* Company views remain available while DAO reads are unavailable. */ }
  let treasuryBalance: string | null = null;
  try {
    const balance = await view<string>(config.settlement_token_id, "ft_balance_of", { account_id: config.dao_id });
    if (/^\d+$/.test(balance)) treasuryBalance = balance;
  } catch { /* Company and distribution views remain available if the token view fails. */ }
  let tokenDecimals: number | null = null;
  try {
    const metadata = await view<{ decimals?: number }>(config.settlement_token_id, "ft_metadata");
    if (Number.isInteger(metadata.decimals) && metadata.decimals! >= 0 && metadata.decimals! <= 24) tokenDecimals = metadata.decimals!;
  } catch { /* Payout amounts stay in base units when token metadata is unavailable. */ }
  return { totals, config, holdings, grants, distributions, deals, rounds, companyAssessment, daoPolicy, daoAssessment, proposals, treasuryBalance, tokenDecimals };
}

export function formatUnits(value: string): string { return BigInt(value).toLocaleString("en-US"); }
export function percent(part: string, total: string): string {
  const denominator = BigInt(total);
  if (!denominator) return "0.00%";
  const basisPoints = (BigInt(part) * 10_000n) / denominator;
  return `${(Number(basisPoints) / 100).toFixed(2)}%`;
}
