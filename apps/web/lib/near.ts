import { JsonRpcProvider } from "near-api-js";

export const network = "testnet";
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org" });

export type Totals = { dao_id: string; authorized_units: string; issued_total: string; pool_available: string; grant_reserved: string; fully_diluted_total: string; unallocated_units: string; ledger_revision: number; holder_count: number };
export type Holding = { account_id: string; issued_units: string };
export type Grant = { id: number; recipient: string; original_units: string; entitlement_cap: string; issued_units: string; vested_units: string; claimable_units: string; boundaries: number[]; cancelled_at: number | null };
export type Entitlement = { account_id: string; units: string; amount: string; payment_status: "Ready" | "InFlight" | "Failed" | "Paid" | "Zero"; attempt_id: number };
export type Distribution = { id: number; snapshot_revision: number; snapshot_timestamp: number; token_id: string; budget: string; expires_at: number; schedule_hash: number[]; approved: boolean; cancelled: boolean; funded: boolean; paid_total: string; in_flight_total: string; available_escrow: string; entitlements: Entitlement[] };

const accountPattern = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export function validAccountId(id: string): boolean { return accountPattern.test(id); }

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!validAccountId(contractId)) throw new Error("Invalid NEAR account ID");
  const result = await provider.callFunction({ contractId, method, args }) as T | undefined;
  if (result === undefined) throw new Error(`${method} returned no result`);
  return result;
}

export async function readCompany(contractId: string) {
  const [totals, holdings, grants, distributions] = await Promise.all([
    view<Totals>(contractId, "get_totals"),
    view<Holding[]>(contractId, "list_holdings", { from_index: 0, limit: 20 }),
    view<Grant[]>(contractId, "list_grants", { from_index: 0, limit: 20 }),
    view<Distribution[]>(contractId, "list_distributions", { from_index: 0, limit: 20 }),
  ]);
  return { totals, holdings, grants, distributions };
}

export function formatUnits(value: string): string { return BigInt(value).toLocaleString("en-US"); }
export function percent(part: string, total: string): string {
  const denominator = BigInt(total);
  if (!denominator) return "0.00%";
  const basisPoints = (BigInt(part) * 10_000n) / denominator;
  return `${(Number(basisPoints) / 100).toFixed(2)}%`;
}
