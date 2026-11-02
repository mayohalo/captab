import type { CompanyConfig, Distribution, Grant, Totals } from "./near";
import { buildMonthlyBoundaries } from "./vesting";
import { assertDistributionHash } from "./distribution-hash";

export type ProposalAction = "founder" | "pool" | "grant" | "cancelGrant" | "approve" | "fund";
export type ProposalRequest = {
  action: ProposalAction;
  expectedRevision: number;
  recipient?: string;
  units?: string;
  startIso?: string;
  grantId?: number;
  distributionId?: number;
};
export type PreparedProposal = { description: string; kind: Record<string, unknown> };

const validAccountId = (id: unknown): id is string => typeof id === "string" && /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id);
const positiveInteger = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d*$/.test(value) && value.length <= 39;

function functionCall(receiverId: string, methodName: string, args: Record<string, unknown>, gas: string, deposit: string) {
  return { FunctionCall: { receiver_id: receiverId, actions: [{ method_name: methodName,
    args: Buffer.from(JSON.stringify(args)).toString("base64"), gas, deposit }] } };
}

export function buildGovernanceProposal(input: ProposalRequest, context: {
  companyId: string; config: CompanyConfig; totals: Totals;
  grant?: Grant | null; distribution?: Distribution | null;
  nowSeconds: number; actionId: string;
}): PreparedProposal {
  const { companyId, config, totals, grant, distribution, nowSeconds, actionId } = context;
  if (config.paused) throw new Error("Company is paused.");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== totals.ledger_revision) {
    throw new Error("Ledger revision changed. Refresh the company and prepare a new proposal.");
  }
  if (config.dao_id !== totals.dao_id) throw new Error("DAO account differs between config and ledger.");
  if (input.action === "founder" || input.action === "pool" || input.action === "grant") {
    if (!positiveInteger(input.units)) throw new Error("Enter a positive whole number of units.");
    const capacity = input.action === "grant" ? totals.pool_available : totals.unallocated_units;
    if (BigInt(input.units) > BigInt(capacity)) throw new Error(input.action === "grant"
      ? "Units exceed the available contributor pool." : "Units exceed unallocated capacity.");
  }
  if (input.action === "founder") {
    if (!validAccountId(input.recipient)) throw new Error("Enter a valid NEAR recipient account.");
    return { description: `Issue ${input.units} founder units to ${input.recipient} (revision ${totals.ledger_revision})`,
      kind: functionCall(companyId, "issue_founder_units", { action_id: actionId,
        expected_revision: totals.ledger_revision, recipient: input.recipient, units: input.units }, "40000000000000", "0") };
  }
  if (input.action === "pool") {
    return { description: `Reserve ${input.units} contributor pool units (revision ${totals.ledger_revision})`,
      kind: functionCall(companyId, "increase_pool", { action_id: actionId,
        expected_revision: totals.ledger_revision, units: input.units }, "40000000000000", "0") };
  }
  if (input.action === "grant") {
    if (!validAccountId(input.recipient)) throw new Error("Enter a valid NEAR recipient account.");
    const boundaries = buildMonthlyBoundaries(input.startIso ?? "");
    return { description: `Grant ${input.units} units to ${input.recipient}; cliff ${new Date(boundaries[12] * 1000).toISOString()} (revision ${totals.ledger_revision})`,
      kind: functionCall(companyId, "create_grant", { action_id: actionId, expected_revision: totals.ledger_revision,
        recipient: input.recipient, units: input.units, boundaries }, "80000000000000", "0") };
  }
  if (input.action === "cancelGrant") {
    if (!grant || grant.id !== input.grantId || grant.cancelled_at !== null) throw new Error("Select an active grant.");
    return { description: `Cancel unvested units in grant #${grant.id} for ${grant.recipient}`,
      kind: functionCall(companyId, "cancel_unvested", { action_id: actionId, grant_id: grant.id }, "40000000000000", "0") };
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
