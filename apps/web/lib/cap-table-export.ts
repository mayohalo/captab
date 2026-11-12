import type { CompanyConfig, Grant, Holding, Totals } from "./near";

export type CapTableExportInput = {
  companyId: string; network: string; generatedAt: string; companyCodeHash: string | null;
  config: CompanyConfig; totals: Totals; holdings: Holding[]; grants: Grant[];
};

/** Percentage with four decimals, computed in integers: 1 unit of `scaled` is 0.0001%. */
export function percent4(part: string | bigint, total: string | bigint): string {
  const denominator = BigInt(total);
  if (denominator === 0n) return "0.0000";
  const scaled = (BigInt(part) * 1_000_000n) / denominator;
  return `${scaled / 10_000n}.${(scaled % 10_000n).toString().padStart(4, "0")}`;
}

const iso = (seconds: number | undefined | null) => seconds == null ? "" : new Date(seconds * 1000).toISOString();

export function buildCapTable(input: CapTableExportInput) {
  const { totals, config } = input;
  const holders = [...input.holdings].sort((a, b) => a.account_id.localeCompare(b.account_id)).map(holding => ({
    accountId: holding.account_id, issuedUnits: holding.issued_units,
    issuedPercent: percent4(holding.issued_units, totals.issued_total),
    fullyDilutedPercent: percent4(holding.issued_units, totals.fully_diluted_total),
  }));
  const grants = [...input.grants].sort((a, b) => a.id - b.id).map(grant => ({
    grantId: grant.id, recipient: grant.recipient, grantedUnits: grant.original_units,
    entitlementCap: grant.entitlement_cap, vestedUnits: grant.vested_units, issuedUnits: grant.issued_units,
    claimableUnits: grant.claimable_units,
    reservedUnits: (BigInt(grant.entitlement_cap) - BigInt(grant.issued_units)).toString(),
    status: grant.cancelled_at === null ? "active" : "cancelled",
    startUtc: iso(grant.boundaries[0]), cliffUtc: iso(grant.boundaries[12]), fullyVestedUtc: iso(grant.boundaries[grant.boundaries.length - 1]),
    cancelledUtc: iso(grant.cancelled_at),
  }));
  return {
    format: "captab.cap-table.v1",
    network: input.network, companyId: input.companyId, generatedAt: input.generatedAt,
    ledgerRevision: totals.ledger_revision, companyCodeHash: input.companyCodeHash,
    daoId: config.dao_id, settlementTokenId: config.settlement_token_id, paused: config.paused,
    totals: {
      authorizedUnits: totals.authorized_units, issuedUnits: totals.issued_total,
      poolAvailableUnits: totals.pool_available, grantReservedUnits: totals.grant_reserved,
      fullyDilutedUnits: totals.fully_diluted_total, unallocatedUnits: totals.unallocated_units,
    },
    holders, grants,
    notice: "Testnet prototype export. Units are on-chain ledger records, not legal shares.",
  };
}

export type CapTable = ReturnType<typeof buildCapTable>;

const CSV_COLUMNS = ["record_type", "account_id", "units", "issued_percent", "fully_diluted_percent", "grant_id", "granted_units",
  "vested_units", "issued_units", "claimable_units", "reserved_units", "grant_status", "start_utc", "cliff_utc", "fully_vested_utc", "cancelled_utc"] as const;

function cell(value: string | number | boolean | null | undefined): string {
  const text = value == null ? "" : String(value);
  // Quote anything a spreadsheet could misread; prefix formula-leading characters so they stay text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll("\"", "\"\"")}"` : safe;
}

export function capTableCsv(table: CapTable): string {
  const rows: Record<string, string | number | null>[] = [
    ...table.holders.map(holder => ({ record_type: "holding", account_id: holder.accountId, units: holder.issuedUnits,
      issued_percent: holder.issuedPercent, fully_diluted_percent: holder.fullyDilutedPercent })),
    ...table.grants.map(grant => ({ record_type: "grant", account_id: grant.recipient, units: grant.reservedUnits,
      fully_diluted_percent: percent4(grant.reservedUnits, table.totals.fullyDilutedUnits), grant_id: grant.grantId,
      granted_units: grant.grantedUnits, vested_units: grant.vestedUnits, issued_units: grant.issuedUnits,
      claimable_units: grant.claimableUnits, reserved_units: grant.reservedUnits, grant_status: grant.status,
      start_utc: grant.startUtc, cliff_utc: grant.cliffUtc, fully_vested_utc: grant.fullyVestedUtc, cancelled_utc: grant.cancelledUtc })),
    { record_type: "pool_available", units: table.totals.poolAvailableUnits,
      fully_diluted_percent: percent4(table.totals.poolAvailableUnits, table.totals.fullyDilutedUnits) },
    { record_type: "total_issued", units: table.totals.issuedUnits, issued_percent: "100.0000",
      fully_diluted_percent: percent4(table.totals.issuedUnits, table.totals.fullyDilutedUnits) },
    { record_type: "total_fully_diluted", units: table.totals.fullyDilutedUnits, fully_diluted_percent: "100.0000" },
    { record_type: "unallocated", units: table.totals.unallocatedUnits },
    { record_type: "authorized", units: table.totals.authorizedUnits },
  ];
  return [CSV_COLUMNS.join(","), ...rows.map(row => CSV_COLUMNS.map(column => cell(row[column])).join(","))].join("\r\n") + "\r\n";
}
