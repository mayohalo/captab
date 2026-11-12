import type { CompanyConfig, Deal, DealKind, Distribution, Grant, Round, Totals } from "./near";
import { buildMonthlyBoundaries } from "./vesting";
import { assertDistributionHash } from "./distribution-hash";

export const V1_ACTIONS = ["founder", "pool", "grant", "cancelGrant", "approve", "fund", "pause", "resume", "cancelDistribution"] as const;
/** Schema v2 board actions: Phase B ledger extensions and Phase C rounds, deals, and explicit payouts. */
export const V2_ACTIONS = ["decreasePool", "increaseAuthorized", "retire", "reassign", "accelerateGrant", "createRound", "closeRound",
  "approveDeal", "cancelDeal", "payBuyback", "explicitDistribution", "closeCompany"] as const;
export type ProposalAction = typeof V1_ACTIONS[number] | typeof V2_ACTIONS[number];
export type PayoutInput = { account_id: string; amount: string };
export type ProposalRequest = {
  action: ProposalAction;
  expectedRevision: number;
  recipient?: string;
  units?: string;
  startIso?: string;
  grantId?: number;
  distributionId?: number;
  /** v2: SHA-256 (hex) of the governing document, recorded with the action. */
  docHash?: string;
  scheduleMonths?: number;
  cliffMonths?: number;
  source?: "pool" | "unallocated";
  months?: number;
  account?: string;
  toAccount?: string;
  authorizedUnits?: string;
  roundId?: string;
  pricePerUnit?: string;
  dealKind?: DealKind;
  seller?: string;
  buyer?: string;
  price?: string;
  expiresInDays?: number;
  dealId?: number;
  payouts?: PayoutInput[];
  label?: string;
};
export type PreparedProposal = { description: string; kind: Record<string, unknown> };

const validAccountId = (id: unknown): id is string => typeof id === "string" && /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id);
const positiveInteger = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d*$/.test(value) && value.length <= 39;
const nonNegativeInteger = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) && value.length <= 39;
const DOC_HASH = /^[0-9a-f]{64}$/;
const ROUND_ID = /^[a-z0-9-]{1,32}$/;
const LABEL = /^[A-Za-z0-9 -]{1,40}$/;
const COMPANY_GAS = "100000000000000";
const HEAVY_GAS = "200000000000000";

function functionCall(receiverId: string, methodName: string, args: Record<string, unknown>, gas: string, deposit: string) {
  return { FunctionCall: { receiver_id: receiverId, actions: [{ method_name: methodName,
    args: Buffer.from(JSON.stringify(args)).toString("base64"), gas, deposit }] } };
}

export function buildGovernanceProposal(input: ProposalRequest, context: {
  companyId: string; config: CompanyConfig; totals: Totals;
  grant?: Grant | null; distribution?: Distribution | null; deal?: Deal | null; round?: Round | null;
  nowSeconds: number; actionId: string;
}): PreparedProposal {
  const { companyId, config, totals, grant, distribution, deal, round, nowSeconds, actionId } = context;
  const v2 = config.schema_version === 2;
  if ((V2_ACTIONS as readonly string[]).includes(input.action) || input.docHash !== undefined || input.source !== undefined ||
      (input.scheduleMonths !== undefined && input.scheduleMonths !== 48) || (input.cliffMonths !== undefined && input.cliffMonths !== 12)) {
    if (!v2) throw new Error("This action needs a schema v2 company contract.");
  }
  if (config.closed) throw new Error("Company is closed.");
  if (input.docHash !== undefined && !DOC_HASH.test(input.docHash)) throw new Error("Document hash must be 64 lowercase hex characters (SHA-256).");
  const doc = v2 ? { doc_hash: input.docHash ?? null } : {};
  const docNote = input.docHash ? `; document ${input.docHash.slice(0, 12)}…` : "";
  const expiresAt = () => {
    const days = input.expiresInDays ?? 14;
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Expiry must be 1 to 365 days.");
    return nowSeconds + days * 86_400;
  };
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== totals.ledger_revision) {
    throw new Error("Ledger revision changed. Refresh the company and prepare a new proposal.");
  }
  if (config.dao_id !== totals.dao_id) throw new Error("DAO account differs between config and ledger.");
  if (input.action === "pause" || input.action === "resume") {
    const paused = input.action === "pause";
    if (config.paused === paused) throw new Error(paused ? "Company is already paused." : "Company is already active.");
    return { description: `${paused ? "Pause" : "Resume"} company ${companyId}`,
      kind: functionCall(companyId, "set_paused", { action_id: actionId, paused }, "40000000000000", "0") };
  }
  if (input.action === "cancelDeal") {
    if (!deal || deal.id !== input.dealId) throw new Error("Select a deal.");
    if (deal.status !== "Approved" && deal.status !== "Accepted") throw new Error("Deal is closed.");
    return { description: `Cancel ${deal.kind.toLowerCase()} deal #${deal.id}`,
      kind: functionCall(companyId, "cancel_deal", { deal_id: deal.id }, COMPANY_GAS, "0") };
  }
  if (input.action === "closeRound") {
    if (!round || round.id !== input.roundId) throw new Error("Select a round.");
    if (round.closed_at !== null) throw new Error("Round is already closed.");
    return { description: `Close round ${round.id} (${round.units_issued} units issued)`,
      kind: functionCall(companyId, "close_round", { action_id: actionId, round_id: round.id }, COMPANY_GAS, "0") };
  }
  if (input.action === "closeCompany") {
    return { description: `Close company ${companyId} permanently${docNote}`,
      kind: functionCall(companyId, "close_company", { action_id: actionId, ...doc }, HEAVY_GAS, "0") };
  }
  if (input.action === "cancelDistribution") {
    if (!distribution || distribution.id !== input.distributionId) throw new Error("Select a distribution.");
    if (distribution.funded || distribution.cancelled) throw new Error("Distribution cannot be cancelled after funding or cancellation.");
    return { description: `Cancel unfunded distribution #${distribution.id}`,
      kind: functionCall(companyId, "cancel_unfunded_distribution", { action_id: actionId,
        distribution_id: distribution.id }, "40000000000000", "0") };
  }
  if (config.paused) throw new Error("Company is paused.");
  if (input.action === "founder" || input.action === "pool" || input.action === "grant" || input.action === "decreasePool" || input.action === "retire") {
    if (!positiveInteger(input.units)) throw new Error("Enter a positive whole number of units.");
    const fromPool = input.action === "decreasePool" || (input.action === "grant" && input.source !== "unallocated");
    const capacity = fromPool ? totals.pool_available : input.action === "retire" ? input.units : totals.unallocated_units;
    if (BigInt(input.units) > BigInt(capacity)) throw new Error(fromPool
      ? "Units exceed the available contributor pool." : "Units exceed unallocated capacity.");
  }
  if (input.action === "increaseAuthorized") {
    if (!positiveInteger(input.authorizedUnits) || BigInt(input.authorizedUnits) <= BigInt(totals.authorized_units)) {
      throw new Error("Authorized units can only increase.");
    }
    return { description: `Raise authorized units from ${totals.authorized_units} to ${input.authorizedUnits} (revision ${totals.ledger_revision})${docNote}`,
      kind: functionCall(companyId, "increase_authorized", { action_id: actionId, expected_revision: totals.ledger_revision,
        authorized_units: input.authorizedUnits, ...doc }, COMPANY_GAS, "0") };
  }
  if (input.action === "decreasePool") {
    return { description: `Return ${input.units} pool units to unallocated capacity (revision ${totals.ledger_revision})${docNote}`,
      kind: functionCall(companyId, "decrease_pool", { action_id: actionId, expected_revision: totals.ledger_revision,
        units: input.units, ...doc }, COMPANY_GAS, "0") };
  }
  if (input.action === "retire") {
    if (!validAccountId(input.account)) throw new Error("Enter the holder account whose units are retired.");
    return { description: `Retire ${input.units} units held by ${input.account} (revision ${totals.ledger_revision})${docNote}`,
      kind: functionCall(companyId, "retire_units", { action_id: actionId, expected_revision: totals.ledger_revision,
        account_id: input.account, units: input.units, ...doc }, COMPANY_GAS, "0") };
  }
  if (input.action === "reassign") {
    if (!validAccountId(input.account) || !validAccountId(input.toAccount) || input.account === input.toAccount) {
      throw new Error("Enter two different accounts: the old wallet and the new one.");
    }
    return { description: `Move ${input.account}'s holding and open grants to ${input.toAccount} (revision ${totals.ledger_revision})${docNote}`,
      kind: functionCall(companyId, "reassign_holding", { action_id: actionId, expected_revision: totals.ledger_revision,
        from: input.account, to: input.toAccount, ...doc }, HEAVY_GAS, "0") };
  }
  if (input.action === "accelerateGrant") {
    if (!grant || grant.id !== input.grantId || grant.cancelled_at !== null) throw new Error("Select an active grant.");
    if (!Number.isInteger(input.months) || input.months! < 1 || input.months! > 120) throw new Error("Accelerate by 1 to 120 months.");
    return { description: `Accelerate grant #${grant.id} for ${grant.recipient} by ${input.months} months${docNote}`,
      kind: functionCall(companyId, "accelerate_grant", { action_id: actionId, grant_id: grant.id, months: input.months, ...doc }, COMPANY_GAS, "0") };
  }
  if (input.action === "createRound") {
    if (!input.roundId || !ROUND_ID.test(input.roundId)) throw new Error("Round ID is 1-32 lowercase letters, digits, or hyphens.");
    if (!positiveInteger(input.pricePerUnit)) throw new Error("Enter the price per unit in token base units.");
    return { description: `Open round ${input.roundId} at ${input.pricePerUnit} token base units per unit${docNote}`,
      kind: functionCall(companyId, "create_round", { action_id: actionId, round_id: input.roundId,
        price_per_unit: input.pricePerUnit, ...doc }, COMPANY_GAS, "0") };
  }
  if (input.action === "approveDeal") {
    if (!positiveInteger(input.units)) throw new Error("Enter a positive whole number of units.");
    const expires_at = expiresAt();
    let terms: Record<string, unknown>;
    if (input.dealKind === "Issue") {
      if (!validAccountId(input.buyer)) throw new Error("Enter the investor account.");
      if (!round || round.id !== input.roundId || round.closed_at !== null) throw new Error("Select an open round.");
      if (BigInt(input.units) > BigInt(totals.unallocated_units)) throw new Error("Units exceed unallocated capacity.");
      const price = (BigInt(input.units) * BigInt(round.price_per_unit)).toString();
      terms = { kind: "Issue", buyer: input.buyer, units: input.units, price, expires_at, round_id: round.id, ...doc };
    } else if (input.dealKind === "Secondary" || input.dealKind === "Buyback") {
      if (!validAccountId(input.seller)) throw new Error("Enter the selling holder.");
      if (!positiveInteger(input.price)) throw new Error("Enter the total price in token base units.");
      if (input.dealKind === "Secondary" && (!validAccountId(input.buyer) || input.buyer === input.seller)) throw new Error("Enter a buyer different from the seller.");
      terms = { kind: input.dealKind, seller: input.seller, ...(input.dealKind === "Secondary" ? { buyer: input.buyer } : {}),
        units: input.units, price: input.price, expires_at, ...doc };
    } else throw new Error("Choose issuance, secondary sale, or buyback.");
    return { description: `Approve ${String(terms.kind).toLowerCase()} deal: ${input.units} units for ${terms.price} token base units${docNote}`,
      kind: functionCall(companyId, "approve_deal", { action_id: actionId, terms }, COMPANY_GAS, "0") };
  }
  if (input.action === "payBuyback") {
    if (!deal || deal.id !== input.dealId) throw new Error("Select a deal.");
    if (deal.kind !== "Buyback" || deal.status !== "Accepted") throw new Error("Only an accepted buyback is paid by the DAO.");
    if (deal.expires_at <= nowSeconds) throw new Error("Deal has expired.");
    return { description: `Pay ${deal.price} token base units for buyback #${deal.id} from ${deal.seller}`,
      kind: functionCall(config.settlement_token_id, "ft_transfer_call", { receiver_id: companyId, amount: deal.price,
        msg: JSON.stringify({ deal_id: deal.id }) }, "150000000000000", "1") };
  }
  if (input.action === "explicitDistribution") {
    const payouts = input.payouts ?? [];
    if (payouts.length < 1 || payouts.length > (config.limits.max_payout_rows ?? 100)) throw new Error("Enter 1 to 100 payout rows.");
    const seen = new Set<string>();
    for (const row of payouts) {
      if (!validAccountId(row?.account_id) || !nonNegativeInteger(row?.amount)) throw new Error("Each payout needs an account and a whole amount in base units.");
      if (seen.has(row.account_id)) throw new Error(`Duplicate payout for ${row.account_id}.`);
      seen.add(row.account_id);
    }
    const budget = payouts.reduce((sum, row) => sum + BigInt(row.amount), 0n);
    if (budget <= 0n) throw new Error("Payouts must total more than zero.");
    if (input.label !== undefined && !LABEL.test(input.label)) throw new Error("Label is 1-40 letters, digits, spaces, or hyphens.");
    return { description: `Explicit payout list${input.label ? ` "${input.label}"` : ""}: ${payouts.length} recipients, ${budget} token base units (revision ${totals.ledger_revision})${docNote}`,
      kind: functionCall(companyId, "prepare_explicit_distribution", { action_id: actionId, expected_revision: totals.ledger_revision,
        budget: budget.toString(), expires_at: expiresAt(), payouts: payouts.map(row => ({ account_id: row.account_id, amount: row.amount })),
        label: input.label ?? null, ...doc }, HEAVY_GAS, "0") };
  }
  if (input.action === "founder") {
    if (!validAccountId(input.recipient)) throw new Error("Enter a valid NEAR recipient account.");
    return { description: `Issue ${input.units} founder units to ${input.recipient} (revision ${totals.ledger_revision})`,
      kind: functionCall(companyId, "issue_founder_units", { action_id: actionId,
        expected_revision: totals.ledger_revision, recipient: input.recipient, units: input.units, ...doc }, "40000000000000", "0") };
  }
  if (input.action === "pool") {
    return { description: `Reserve ${input.units} contributor pool units (revision ${totals.ledger_revision})`,
      kind: functionCall(companyId, "increase_pool", { action_id: actionId,
        expected_revision: totals.ledger_revision, units: input.units, ...doc }, "40000000000000", "0") };
  }
  if (input.action === "grant") {
    if (!validAccountId(input.recipient)) throw new Error("Enter a valid NEAR recipient account.");
    const months = input.scheduleMonths ?? 48;
    const cliff = input.cliffMonths ?? 12;
    if (!Number.isInteger(cliff) || cliff < 0 || cliff > months) throw new Error("The cliff must fall within the schedule.");
    const boundaries = buildMonthlyBoundaries(input.startIso ?? "", months);
    const terms = v2 ? { terms: { cliff_index: cliff, source: input.source === "unallocated" ? "Unallocated" : "Pool" } } : {};
    const cliffText = cliff ? `cliff ${new Date(boundaries[cliff] * 1000).toISOString()}` : "no cliff";
    return { description: `Grant ${input.units} units to ${input.recipient} over ${months} months; ${cliffText}${input.source === "unallocated" ? "; founder grant from unallocated capacity" : ""} (revision ${totals.ledger_revision})${docNote}`,
      kind: functionCall(companyId, "create_grant", { action_id: actionId, expected_revision: totals.ledger_revision,
        recipient: input.recipient, units: input.units, boundaries, ...doc, ...terms }, "80000000000000", "0") };
  }
  if (input.action === "cancelGrant") {
    if (!grant || grant.id !== input.grantId || grant.cancelled_at !== null) throw new Error("Select an active grant.");
    return { description: `Cancel unvested units in grant #${grant.id} for ${grant.recipient}`,
      kind: functionCall(companyId, "cancel_unvested", { action_id: actionId, grant_id: grant.id, ...doc }, "40000000000000", "0") };
  }
  if (input.action !== "approve" && input.action !== "fund") throw new Error("Unsupported governance action.");
  if (!distribution || distribution.id !== input.distributionId) throw new Error("Select a distribution.");
  if (distribution.cancelled || distribution.funded) throw new Error("Distribution is closed.");
  if (distribution.expires_at <= nowSeconds) throw new Error("Distribution has expired.");
  if (distribution.token_id !== config.settlement_token_id || distribution.schedule_hash.length !== 32) {
    throw new Error("Distribution token or schedule hash is invalid.");
  }
  assertDistributionHash(companyId, distribution);
  if (input.action === "approve") {
    if (distribution.approved) throw new Error("Distribution is already approved.");
    return { description: `Approve distribution #${distribution.id} schedule hash`,
      kind: functionCall(companyId, "approve_distribution", { action_id: actionId,
        distribution_id: distribution.id, schedule_hash: distribution.schedule_hash }, "40000000000000", "0") };
  }
  if (!distribution.approved) throw new Error("Approve the schedule before funding.");
  return { description: `Fund distribution #${distribution.id} with ${distribution.budget} token base units`,
    kind: functionCall(distribution.token_id, "ft_transfer_call", { receiver_id: companyId,
      amount: distribution.budget, msg: JSON.stringify({ distribution_id: distribution.id,
        schedule_hash: distribution.schedule_hash }) }, "120000000000000", "1") };
}
