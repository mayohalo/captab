import { setTimeout as delay } from "node:timers/promises";

const baseUrl = process.env.CAPTAB_BASE_URL ?? "http://127.0.0.1:3000";
const secret = process.env.CAPTAB_WORKER_SECRET;
if (!secret) throw new Error("Set CAPTAB_WORKER_SECRET before starting the reconciliation worker.");

for (;;) {
  try {
    const response = await fetch(new URL("/api/internal/reconcile", baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`Reconciliation HTTP ${response.status}`);
    const result = await response.json();
    if (result.checked) console.log(`Reconciled ${result.checked} operation(s):`, result.results);
    if (result.payments?.length) console.log("Payment observations:", result.payments);
    if (result.audits?.length) console.log("Company audits:", result.audits);
    if (result.submission?.submitted) console.log("Submitted payment:", result.submission);
    if (result.submission?.reason?.includes("review required")) console.error(result.submission.reason);
  } catch (error) {
    console.error("Reconciliation attempt failed:", error instanceof Error ? error.message : error);
  }
  await delay(30_000);
}
