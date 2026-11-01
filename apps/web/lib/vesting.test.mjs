import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMonthlyBoundaries, vestedAt } from "./vesting.ts";

const iso = seconds => new Date(seconds * 1000).toISOString();

test("month ends are anchored to the original start day", () => {
  const boundaries = buildMonthlyBoundaries("2027-01-31T12:34:56Z");
  assert.equal(boundaries.length, 49);
  assert.equal(iso(boundaries[0]), "2027-01-31T12:34:56.000Z");
  assert.equal(iso(boundaries[1]), "2027-02-28T12:34:56.000Z");
  assert.equal(iso(boundaries[2]), "2027-03-31T12:34:56.000Z");
  assert.equal(iso(boundaries[12]), "2028-01-31T12:34:56.000Z");
  assert.equal(iso(boundaries[48]), "2031-01-31T12:34:56.000Z");
});

test("leap-day clamp and cliff calculation", () => {
  const boundaries = buildMonthlyBoundaries("2028-01-31T00:00:00Z");
  assert.equal(iso(boundaries[1]), "2028-02-29T00:00:00.000Z");
  assert.equal(vestedAt("100", boundaries, boundaries[12] - 1), "0");
  assert.equal(vestedAt("100", boundaries, boundaries[12]), "25");
  assert.equal(vestedAt("100", boundaries, boundaries[48]), "100");
  assert.equal(vestedAt("100", boundaries, boundaries[48], "37"), "37");
});

test("rejects local time and normalized invalid dates", () => {
  assert.throws(() => buildMonthlyBoundaries("2028-01-31T00:00:00"));
  assert.throws(() => buildMonthlyBoundaries("2028-02-30T00:00:00Z"));
  assert.throws(() => buildMonthlyBoundaries("0001-01-01T00:00:00Z"));
});
