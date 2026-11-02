import assert from "node:assert/strict";
import test from "node:test";
import { describeObservation } from "./observed-status.mjs";

test("transaction messages distinguish finality and uncertainty", () => {
  assert.match(describeObservation({ status: "Pending" }), /Executing/);
  assert.match(describeObservation({ status: "Confirmed" }), /Confirmed in final receipts/);
  assert.match(describeObservation({ status: "Failed" }), /Failed in final receipts/);
  assert.match(describeObservation({ status: "NeedsReview" }), /before retrying/);
  assert.match(describeObservation(null), /Outcome unknown/);
  assert.match(describeObservation({ status: "Unexpected" }), /Outcome unknown/);
});
