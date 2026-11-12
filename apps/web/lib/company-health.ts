import type { CompanyConfig, Deal, Distribution, Grant, Holding, Totals } from "./near";

export type CompanyAudit = { state: "Consistent" | "Inconsistent" | "Inconclusive"; checkedRevision: number; issues: string[] };

export function assessCompanyLedger(input: {
  totals: Totals; config: CompanyConfig; holdings: Holding[]; grants: Grant[];
  distributions: Distribution[]; deals?: Deal[]; revisionAfter: number;
}): CompanyAudit {
  const { totals, config, holdings, grants, distributions, revisionAfter } = input;
  const deals = input.deals ?? [];
  if (totals.ledger_revision !== revisionAfter) return {
    state: "Inconclusive", checkedRevision: revisionAfter,
    issues: ["Ledger revision changed while the chain views were read; retry the audit."],
  };
  const issues: string[] = [];
  try {
    const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), 0n);
    const issued = sum(holdings.map(row => row.issued_units));
    const reserved = grants.reduce((total, grant) => {
      const remaining = BigInt(grant.entitlement_cap) - BigInt(grant.issued_units);
      if (remaining < 0n) issues.push(`Grant #${grant.id} issued more than its entitlement cap.`);
      return total + remaining;
    }, 0n);
    if (config.dao_id !== totals.dao_id) issues.push("DAO account differs between config and ledger.");
    if (config.authorized_units !== totals.authorized_units) issues.push("Authorized units differ between config and ledger.");
    if (issued !== BigInt(totals.issued_total)) issues.push("Issued units differ from enumerated holdings.");
    if (reserved !== BigInt(totals.grant_reserved)) issues.push("Grant reservations differ from enumerated grants.");
    if (holdings.length !== totals.holder_count) issues.push("Holder count differs from enumerated holdings.");
    const fullyDiluted = BigInt(totals.issued_total) + BigInt(totals.pool_available) + BigInt(totals.grant_reserved);
    if (fullyDiluted !== BigInt(totals.fully_diluted_total)) issues.push("Fully diluted total does not reconcile.");
    const dealReserved = BigInt(totals.deal_reserved ?? "0");
    if (fullyDiluted + dealReserved + BigInt(totals.unallocated_units) !== BigInt(totals.authorized_units)) issues.push("Authorized capacity does not reconcile.");
    const openIssuance = sum(deals.filter(deal => deal.kind === "Issue" && deal.status === "Approved").map(deal => deal.units));
    if (openIssuance !== dealReserved) issues.push("Reserved investor units differ from open issuance deals.");
    for (const holding of holdings) {
      if (BigInt(holding.locked_units ?? "0") > BigInt(holding.issued_units)) issues.push(`${holding.account_id} has more locked than issued units.`);
    }
    const lockedBySeller = new Map<string, bigint>();
    for (const deal of deals) {
      if (deal.status === "Accepted" && deal.seller) lockedBySeller.set(deal.seller, (lockedBySeller.get(deal.seller) ?? 0n) + BigInt(deal.units));
    }
    for (const holding of holdings) {
      if ((lockedBySeller.get(holding.account_id) ?? 0n) !== BigInt(holding.locked_units ?? "0")) issues.push(`${holding.account_id} locked units differ from accepted deals.`);
    }
    for (const distribution of distributions) {
      const label = `Distribution #${distribution.id}`;
      const budget = BigInt(distribution.budget);
      const paid = BigInt(distribution.paid_total);
      const inFlight = BigInt(distribution.in_flight_total);
      const available = BigInt(distribution.available_escrow);
      if (sum(distribution.entitlements.map(row => row.amount)) !== budget) issues.push(`${label} entitlements differ from budget.`);
      if (sum(distribution.entitlements.filter(row => row.payment_status === "Paid").map(row => row.amount)) !== paid) issues.push(`${label} paid total differs from recipient states.`);
      if (sum(distribution.entitlements.filter(row => row.payment_status === "InFlight").map(row => row.amount)) !== inFlight) issues.push(`${label} in-flight total differs from recipient states.`);
      if (distribution.funded) {
        if (paid + inFlight + available !== budget) issues.push(`${label} funded escrow does not reconcile.`);
        if (sum(distribution.entitlements.filter(row => row.payment_status === "Ready" || row.payment_status === "Failed").map(row => row.amount)) !== available) issues.push(`${label} available escrow differs from unpaid recipients.`);
      } else if (paid !== 0n || inFlight !== 0n || available !== 0n) {
        issues.push(`${label} has escrow accounting before funding.`);
      }
    }
  } catch {
    issues.push("Chain view contained an invalid numeric value.");
  }
  return { state: issues.length ? "Inconsistent" : "Consistent", checkedRevision: revisionAfter, issues };
}
