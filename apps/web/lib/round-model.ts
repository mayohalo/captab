// Pro forma model for a priced round. Integer math only: money in cents, percentages in basis points.
import type { Holding, Totals } from "./near";

export type RoundInput = {
  holdings: Holding[]; totals: Totals;
  preMoneyCents: bigint; investmentCents: bigint;
  /** Target available pool as a share of post-money fully diluted units, in basis points (0 = no top-up). */
  targetPoolBps: bigint;
  investorLabel: string;
};

export type RoundRow = { label: string; kind: "holder" | "reserved" | "pool" | "investor"; before: bigint; after: bigint };

export type RoundResult = {
  rows: RoundRow[];
  beforeFullyDiluted: bigint; afterFullyDiluted: bigint;
  poolTopUp: bigint; investorUnits: bigint;
  /** Price per unit in millionths of a currency unit. */
  pricePerUnitMicros: bigint;
  postMoneyCents: bigint;
  newUnitsNeeded: bigint; unallocatedBefore: bigint; exceedsAuthorized: boolean;
};

const BPS = 10_000n;

export function parseMoneyCents(text: string): bigint | null {
  const match = /^\s*(\d{1,15})(?:\.(\d{1,2}))?\s*$/.exec(text.replaceAll(",", ""));
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
}

export function parsePercentBps(text: string): bigint | null {
  const match = /^\s*(\d{1,2})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
}

export function modelRound(input: RoundInput): RoundResult {
  const { totals, preMoneyCents: V, investmentCents: I, targetPoolBps: P } = input;
  if (V <= 0n) throw new Error("Pre-money valuation must be positive.");
  if (I <= 0n) throw new Error("Investment must be positive.");
  if (P < 0n || P >= BPS) throw new Error("Pool target must be below 100%.");
  const F = BigInt(totals.fully_diluted_total);
  const pool = BigInt(totals.pool_available);
  if (F <= 0n) throw new Error("The company has no fully diluted units to price.");

  // The pool top-up x is pre-money, so it dilutes existing holders but not the investor.
  // Post-money fully diluted = (F + x)(V + I) / V, and pool + x must equal P of that:
  // x = (P(V+I)F - BPS·V·pool) / (BPS·V - P(V+I)), floored and never negative.
  let poolTopUp = 0n;
  if (P > 0n) {
    const denominator = BPS * V - P * (V + I);
    if (denominator <= 0n) throw new Error("Pool target is too high for this valuation and investment.");
    const numerator = P * (V + I) * F - BPS * V * pool;
    if (numerator > 0n) poolTopUp = numerator / denominator;
  }
  const preMoneyUnits = F + poolTopUp;
  const investorUnits = (I * preMoneyUnits) / V;
  const afterFullyDiluted = preMoneyUnits + investorUnits;
  const newUnitsNeeded = poolTopUp + investorUnits;
  const unallocatedBefore = BigInt(totals.unallocated_units);

  const rows: RoundRow[] = [...input.holdings].sort((a, b) => a.account_id.localeCompare(b.account_id))
    .map(holding => ({ label: holding.account_id, kind: "holder", before: BigInt(holding.issued_units), after: BigInt(holding.issued_units) }));
  rows.push({ label: "Granted, not yet issued", kind: "reserved", before: BigInt(totals.grant_reserved), after: BigInt(totals.grant_reserved) });
  rows.push({ label: "Available pool", kind: "pool", before: pool, after: pool + poolTopUp });
  rows.push({ label: input.investorLabel.trim() || "New investor", kind: "investor", before: 0n, after: investorUnits });

  return {
    rows, beforeFullyDiluted: F, afterFullyDiluted, poolTopUp, investorUnits,
    pricePerUnitMicros: (V * 10_000n) / preMoneyUnits,
    postMoneyCents: V + I, newUnitsNeeded, unallocatedBefore,
    exceedsAuthorized: newUnitsNeeded > unallocatedBefore,
  };
}

export function formatBps(part: bigint, total: bigint): string {
  if (total === 0n) return "0.00%";
  const bps = (part * BPS) / total;
  return `${bps / 100n}.${(bps % 100n).toString().padStart(2, "0")}%`;
}

export function formatCents(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const value = cents < 0n ? -cents : cents;
  return `${sign}$${(value / 100n).toLocaleString("en-US")}.${(value % 100n).toString().padStart(2, "0")}`;
}

export function formatMicros(micros: bigint): string {
  return `$${(micros / 1_000_000n).toLocaleString("en-US")}.${(micros % 1_000_000n).toString().padStart(6, "0")}`;
}
