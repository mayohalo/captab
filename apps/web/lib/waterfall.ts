// Exit waterfall preview with liquidation preferences. Exact rational math, then largest-remainder
// rounding to cents so the rows always sum to the proceeds (the same rule the contract uses for payouts).
import type { Grant, Holding } from "./near";

export type UnvestedTreatment = "accelerate" | "cancel";
export type Preference = { accountId: string; investedCents: bigint; multipleBps: bigint; participating: boolean };
export type WaterfallInput = {
  holdings: Holding[]; grants: Grant[]; proceedsCents: bigint; unvested: UnvestedTreatment; preferences: Preference[];
};
export type WaterfallRow = {
  accountId: string; units: bigint; preferenceCents: bigint; takesPreference: boolean; converted: boolean;
  payoutCents: bigint; proRataCents: bigint;
};
export type WaterfallResult = { rows: WaterfallRow[]; totalUnits: bigint; proceedsCents: bigint };

type Rational = { n: bigint; d: bigint };
const ZERO: Rational = { n: 0n, d: 1n };
const add = (a: Rational, b: Rational): Rational => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const greater = (a: Rational, b: Rational) => a.n * b.d > b.n * a.d;

/** Units each account would hold at exit: issued units plus vested-unissued grant units, plus unvested if accelerated. */
export function exitUnits(holdings: Holding[], grants: Grant[], unvested: UnvestedTreatment): Map<string, bigint> {
  const units = new Map<string, bigint>();
  const credit = (account: string, value: bigint) => { if (value > 0n) units.set(account, (units.get(account) ?? 0n) + value); };
  for (const holding of holdings) credit(holding.account_id, BigInt(holding.issued_units));
  for (const grant of grants) {
    const issued = BigInt(grant.issued_units);
    // A cancelled grant's entitlement cap already equals its vested units, so acceleration adds nothing to it.
    credit(grant.recipient, (unvested === "accelerate" ? BigInt(grant.entitlement_cap) : BigInt(grant.vested_units)) - issued);
  }
  return units;
}

function payouts(units: Map<string, bigint>, prefs: Map<string, Preference & { claim: bigint }>, converted: Set<string>, proceeds: bigint) {
  const result = new Map<string, Rational>([...units.keys()].map(account => [account, ZERO]));
  const takers = [...prefs.values()].filter(pref => pref.participating || !converted.has(pref.accountId));
  const totalClaims = takers.reduce((sum, pref) => sum + pref.claim, 0n);
  let residual = proceeds;
  if (totalClaims > 0n) {
    const paid = proceeds < totalClaims ? proceeds : totalClaims;
    for (const pref of takers) result.set(pref.accountId, add(result.get(pref.accountId)!, { n: paid * pref.claim, d: totalClaims }));
    residual = proceeds - paid;
  }
  const commonUnits = [...units].filter(([account]) => {
    const pref = prefs.get(account);
    return !pref || pref.participating || converted.has(account);
  });
  const totalCommon = commonUnits.reduce((sum, [, value]) => sum + value, 0n);
  if (residual > 0n) {
    if (totalCommon === 0n) throw new Error("No common units are left to receive the proceeds above the preferences.");
    for (const [account, value] of commonUnits) result.set(account, add(result.get(account)!, { n: residual * value, d: totalCommon }));
  }
  return result;
}

function roundToCents(exact: Map<string, Rational>, proceeds: bigint): Map<string, bigint> {
  const rows = [...exact].map(([account, value]) => ({ account, floor: value.n / value.d, remainder: { n: value.n % value.d, d: value.d } }));
  let leftover = proceeds - rows.reduce((sum, row) => sum + row.floor, 0n);
  rows.sort((a, b) => greater(a.remainder, b.remainder) ? -1 : greater(b.remainder, a.remainder) ? 1 : a.account.localeCompare(b.account));
  const rounded = new Map<string, bigint>();
  for (const row of rows) {
    const bump = leftover > 0n && row.remainder.n > 0n ? 1n : 0n;
    leftover -= bump;
    rounded.set(row.account, row.floor + bump);
  }
  if (leftover !== 0n) throw new Error("Waterfall rounding did not allocate the full proceeds.");
  return rounded;
}

export function computeWaterfall(input: WaterfallInput): WaterfallResult {
  if (input.proceedsCents <= 0n) throw new Error("Exit proceeds must be positive.");
  const units = exitUnits(input.holdings, input.grants, input.unvested);
  const totalUnits = [...units.values()].reduce((sum, value) => sum + value, 0n);
  if (totalUnits === 0n) throw new Error("No units would be outstanding at exit.");
  const prefs = new Map<string, Preference & { claim: bigint }>();
  for (const pref of input.preferences) {
    if (!units.has(pref.accountId)) throw new Error(`${pref.accountId} holds no units at exit.`);
    if (prefs.has(pref.accountId)) throw new Error(`${pref.accountId} has more than one preference.`);
    if (pref.investedCents <= 0n || pref.multipleBps <= 0n) throw new Error("Preferences need a positive investment and multiple.");
    prefs.set(pref.accountId, { ...pref, claim: (pref.investedCents * pref.multipleBps) / 10_000n });
  }

  // Each non-participating holder converts to common when that pays more. Repeat until no holder
  // would change their choice; the iteration cap guards against oscillation.
  const converted = new Set<string>();
  let current = payouts(units, prefs, converted, input.proceedsCents);
  const candidates = [...prefs.values()].filter(pref => !pref.participating).map(pref => pref.accountId).sort();
  for (let round = 0, changed = true; changed && round < 4 * candidates.length + 4; round++) {
    changed = false;
    for (const account of candidates) {
      const trial = new Set(converted);
      if (trial.has(account)) trial.delete(account); else trial.add(account);
      const next = payouts(units, prefs, trial, input.proceedsCents);
      if (greater(next.get(account)!, current.get(account)!)) {
        converted.clear(); trial.forEach(value => converted.add(value));
        current = next; changed = true;
      }
    }
  }

  const payout = roundToCents(current, input.proceedsCents);
  const proRata = roundToCents(payouts(units, new Map(), new Set(), input.proceedsCents), input.proceedsCents);
  const rows = [...units].map(([accountId, value]) => {
    const pref = prefs.get(accountId);
    return { accountId, units: value, preferenceCents: pref?.claim ?? 0n,
      takesPreference: Boolean(pref && (pref.participating || !converted.has(accountId))), converted: converted.has(accountId),
      payoutCents: payout.get(accountId) ?? 0n, proRataCents: proRata.get(accountId) ?? 0n };
  }).sort((a, b) => a.accountId.localeCompare(b.accountId));
  return { rows, totalUnits, proceedsCents: input.proceedsCents };
}

export function parseMultipleBps(text: string): bigint | null {
  const match = /^\s*(\d{1,2})(?:\.(\d{1,2}))?\s*x?\s*$/i.exec(text);
  if (!match) return null;
  return BigInt(match[1]) * 10_000n + BigInt((match[2] ?? "").padEnd(2, "0") || "0") * 100n;
}
