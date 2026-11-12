import assert from "node:assert/strict";
import test from "node:test";
import { buildCapTable, capTableCsv, percent4 } from "./cap-table-export.ts";
import { formatMicros, modelRound, parseMoneyCents, parsePercentBps } from "./round-model.ts";
import { computeWaterfall, exitUnits, parseMultipleBps } from "./waterfall.ts";

const boundaries = Array.from({ length: 49 }, (_, month) => Math.floor(Date.UTC(2025, month, 1) / 1000));
const totals = { dao_id: "board.testnet", authorized_units: "10000000", issued_total: "6025000", pool_available: "1900000",
  grant_reserved: "75000", fully_diluted_total: "8000000", unallocated_units: "2000000", ledger_revision: 4, holder_count: 3 };
const holdings = [
  { account_id: "founder-a.testnet", issued_units: "3600000" },
  { account_id: "founder-b.testnet", issued_units: "2400000" },
  { account_id: "contributor.testnet", issued_units: "25000" },
];
const grants = [
  { id: 0, recipient: "contributor.testnet", original_units: "100000", entitlement_cap: "100000", issued_units: "25000",
    vested_units: "25000", claimable_units: "0", boundaries, cancelled_at: null },
  { id: 1, recipient: "past.testnet", original_units: "1000", entitlement_cap: "0", issued_units: "0",
    vested_units: "0", claimable_units: "0", boundaries, cancelled_at: 1_740_000_000 },
];
const config = { schema_version: 1, dao_id: "board.testnet", snapshot_operator_id: "operator.testnet",
  settlement_token_id: "testusd.testnet", authorized_units: "10000000", paused: false,
  limits: { max_holders: 20, max_grants: 100, max_distributions: 20, max_actions: 200, vesting_boundaries: 49 } };
const sum = values => values.reduce((total, value) => total + value, 0n);

test("cap table export reconciles to the ledger and escapes spreadsheet formulas", () => {
  assert.equal(percent4("3600000", "8000000"), "45.0000");
  assert.equal(percent4("1", "3"), "33.3333");
  assert.equal(percent4("5", "0"), "0.0000");
  const table = buildCapTable({ companyId: "company.testnet", network: "testnet", generatedAt: "2026-11-13T00:00:00.000Z",
    companyCodeHash: "hash", config, totals, holdings, grants });
  assert.equal(table.ledgerRevision, 4);
  assert.deepEqual(table.holders.map(holder => holder.accountId), ["contributor.testnet", "founder-a.testnet", "founder-b.testnet"]);
  assert.equal(sum(table.holders.map(holder => BigInt(holder.issuedUnits))), BigInt(totals.issued_total));
  assert.equal(sum(table.grants.map(grant => BigInt(grant.reservedUnits))), BigInt(totals.grant_reserved));
  assert.equal(table.grants[0].cliffUtc, "2026-01-01T00:00:00.000Z");
  assert.equal(table.grants[1].status, "cancelled");
  const csv = capTableCsv(table).split("\r\n");
  assert.equal(csv[0].split(",")[0], "record_type");
  assert.equal(csv[1], "holding,contributor.testnet,25000,0.4149,0.3125,,,,,,,,,,,");
  assert.ok(csv.includes("authorized,,10000000,,,,,,,,,,,,,"));
  const hostile = capTableCsv(buildCapTable({ companyId: "c", network: "testnet", generatedAt: "", companyCodeHash: null, config,
    totals, holdings: [{ account_id: "=cmd|x", issued_units: "1" }], grants: [] }));
  assert.match(hostile, /holding,'=cmd\|x,/);
  assert.match(capTableCsv(buildCapTable({ companyId: "c", network: "testnet", generatedAt: "", companyCodeHash: null, config,
    totals, holdings: [{ account_id: "a,\"b", issued_units: "1" }], grants: [] })), /holding,"a,""b",/);
});

test("round model prices units on pre-money fully diluted units", () => {
  assert.equal(parseMoneyCents("8,000,000"), 800_000_000n);
  assert.equal(parseMoneyCents("1.5"), 150n);
  assert.equal(parseMoneyCents("1.234"), null);
  assert.equal(parsePercentBps("12.5"), 1250n);
  assert.equal(parsePercentBps("100"), null);
  const base = { holdings, totals, preMoneyCents: 800_000_000n, investmentCents: 200_000_000n, investorLabel: "Seed" };
  const noTopUp = modelRound({ ...base, targetPoolBps: 1000n });
  assert.equal(noTopUp.poolTopUp, 0n, "a 19% pool already exceeds a 10% target");
  assert.equal(noTopUp.investorUnits, 2_000_000n);
  assert.equal(formatMicros(noTopUp.pricePerUnitMicros), "$1.000000");
  assert.equal(noTopUp.afterFullyDiluted, 10_000_000n);
  assert.equal(noTopUp.exceedsAuthorized, false);
  assert.equal(noTopUp.rows.find(row => row.kind === "investor").after, 2_000_000n);

  const topUp = modelRound({ ...base, targetPoolBps: 2500n });
  assert.equal(topUp.poolTopUp, 872_727n);
  assert.equal(topUp.investorUnits, 2_218_181n);
  assert.equal(formatMicros(topUp.pricePerUnitMicros), "$0.901639");
  const poolAfter = topUp.rows.find(row => row.kind === "pool").after;
  assert.ok(poolAfter * 10_000n / topUp.afterFullyDiluted >= 2499n, "pool lands on the 25% target");
  assert.equal(topUp.exceedsAuthorized, true);
  assert.equal(sum(topUp.rows.map(row => row.after)), topUp.afterFullyDiluted);
  assert.throws(() => modelRound({ ...base, targetPoolBps: 9000n }), /too high/);
  assert.throws(() => modelRound({ ...base, investmentCents: 0n, targetPoolBps: 0n }), /Investment/);
});

test("waterfall converts preferences only when common pays more, and sums to the proceeds", () => {
  assert.equal(parseMultipleBps("1.5x"), 15_000n);
  assert.deepEqual(exitUnits(holdings, grants, "accelerate").get("contributor.testnet"), 100_000n);
  assert.deepEqual(exitUnits(holdings, grants, "cancel").get("contributor.testnet"), 25_000n);
  assert.equal(exitUnits(holdings, grants, "accelerate").has("past.testnet"), false);
  const preferences = [{ accountId: "founder-b.testnet", investedCents: 200_000_000n, multipleBps: 10_000n, participating: false }];
  const payout = (result, account) => result.rows.find(row => row.accountId === account);

  const big = computeWaterfall({ holdings, grants, proceedsCents: 1_000_000_000n, unvested: "accelerate", preferences });
  assert.equal(payout(big, "founder-b.testnet").converted, true);
  assert.deepEqual(big.rows.map(row => [row.accountId, row.payoutCents]), [
    ["contributor.testnet", 16_393_443n], ["founder-a.testnet", 590_163_934n], ["founder-b.testnet", 393_442_623n]]);
  assert.deepEqual(big.rows.map(row => row.payoutCents), big.rows.map(row => row.proRataCents));

  const small = computeWaterfall({ holdings, grants, proceedsCents: 300_000_000n, unvested: "accelerate", preferences });
  assert.equal(payout(small, "founder-b.testnet").converted, false);
  assert.equal(payout(small, "founder-b.testnet").payoutCents, 200_000_000n);
  assert.equal(payout(small, "founder-a.testnet").payoutCents, 97_297_297n);
  assert.equal(payout(small, "contributor.testnet").payoutCents, 2_702_703n);
  assert.equal(sum(small.rows.map(row => row.payoutCents)), 300_000_000n);

  const underwater = computeWaterfall({ holdings, grants, proceedsCents: 150_000_000n, unvested: "cancel", preferences });
  assert.equal(payout(underwater, "founder-b.testnet").payoutCents, 150_000_000n);
  assert.equal(payout(underwater, "founder-a.testnet").payoutCents, 0n);

  const participating = computeWaterfall({ holdings, grants, proceedsCents: 1_000_000_000n, unvested: "accelerate",
    preferences: [{ ...preferences[0], participating: true }] });
  // $2M preference, then $8M shared over 6.1M units: B gets 2M + 8M × 2.4 / 6.1.
  assert.equal(payout(participating, "founder-b.testnet").payoutCents, 200_000_000n + 314_754_098n);
  assert.equal(sum(participating.rows.map(row => row.payoutCents)), 1_000_000_000n);

  const both = computeWaterfall({ holdings, grants, proceedsCents: 777_777_777n, unvested: "cancel", preferences: [
    preferences[0], { accountId: "founder-a.testnet", investedCents: 50_000_000n, multipleBps: 20_000n, participating: false }] });
  assert.equal(sum(both.rows.map(row => row.payoutCents)), 777_777_777n);
  assert.throws(() => computeWaterfall({ holdings, grants, proceedsCents: 1n, unvested: "cancel",
    preferences: [{ ...preferences[0], accountId: "nobody.testnet" }] }), /holds no units/);
});
