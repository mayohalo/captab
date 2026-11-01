export type PaymentObservation = { attempt_id: number; payment_status: "Ready" | "InFlight" | "Failed" | "Paid" | "Zero" };

export function classifyPayment(attemptId: number, row: PaymentObservation): "Settled" | "Failed" | "NeedsReview" {
  if (row.attempt_id !== attemptId) return "NeedsReview";
  return row.payment_status === "Paid" ? "Settled" : row.payment_status === "Failed" ? "Failed" : "NeedsReview";
}
