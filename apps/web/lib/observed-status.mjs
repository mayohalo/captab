export function describeObservation(observed) {
  if (!observed) return "Outcome unknown: history sync is unavailable. Keep the transaction hash for review.";
  switch (observed.status) {
    case "Pending": return "Executing: waiting for final receipts.";
    case "Confirmed": return "Confirmed in final receipts. Refresh to verify the resulting company state.";
    case "Failed": return "Failed in final receipts. Inspect the transaction before retrying.";
    case "NeedsReview": return "Outcome needs review. Inspect receipts and on-chain state before retrying.";
    default: return "Outcome unknown: history returned an unrecognized state. Keep the transaction hash.";
  }
}
