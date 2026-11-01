import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureCompany, openDatabase } from "./db.ts";
import { reserveSponsorRequest } from "./sponsor-rate.ts";

test("sponsored claims are unique and capped to three per account per hour", () => {
  const db = openDatabase(":memory:");
  try {
    const companyId = ensureCompany(db, "company.testnet", "dao.testnet");
    const request = digest => ({ digest, companyId, accountId: "alice.testnet", grantId: 1, gas: 30_000_000_000_000n });
    reserveSponsorRequest(db, request("first"));
    assert.throws(() => reserveSponsorRequest(db, request("first")), /UNIQUE constraint failed/);
    reserveSponsorRequest(db, request("second"));
    reserveSponsorRequest(db, request("third"));
    assert.throws(() => reserveSponsorRequest(db, request("fourth")), /rate limit/);
    const rows = db.prepare("SELECT COUNT(*) AS count FROM sponsor_requests").get();
    assert.equal(rows.count, 3);
  } finally { db.close(); }
});
