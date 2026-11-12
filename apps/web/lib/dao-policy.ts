export const PINNED_SPUTNIK_CODE_HASH = "CB5QxzaBMy3kArDdQJPX3sEsXSeNdfLW4vx9qMn6uCgq";

export type DaoPolicy = {
  proposal_bond: string;
  default_vote_policy?: { weight_kind?: string; quorum?: string | number; threshold?: number[] | string };
  roles: { name: string; kind: { Group?: string[] } | string | Record<string, unknown>; permissions?: string[]; vote_policy?: Record<string, unknown> }[];
};

export type CouncilRule = { members: number; required: number };
export type DaoAssessment = { verified: boolean; reason: string; rule?: CouncilRule };

const MAX_COUNCIL = 50;
// Permissions that let a role approve the FunctionCall ("call") proposals Captab submits.
const APPROVE_CALL = new Set(["*:*", "*:VoteApprove", "call:*", "call:VoteApprove"]);
// Any permission that lets a role vote on (approve, reject, or remove) those proposals.
const VOTES_ON_CALL = /^(\*|call):(\*|Vote[A-Za-z]*)$/;

function groupMembers(kind: DaoPolicy["roles"][number]["kind"]): string[] | null {
  return typeof kind === "object" && kind !== null && Array.isArray((kind as { Group?: unknown }).Group)
    ? (kind as { Group: string[] }).Group : null;
}

function positiveInteger(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,6}$/.test(text)) return null;
  return Number(text);
}

/**
 * Approvals Sputnik requires for a council of `members` under a RoleWeight policy:
 * max(quorum, threshold weight), where a ratio threshold n/d needs min(floor(n * members / d) + 1, members)
 * and a fixed weight w needs min(w, members). Mirrors Sputnik's `VotePolicy` and `WeightOrRatio::to_weight`.
 */
export function requiredApprovals(vote: DaoPolicy["default_vote_policy"], members: number): number | null {
  if (!vote || vote.weight_kind !== "RoleWeight") return null;
  const quorum = positiveInteger(vote.quorum ?? "0");
  if (quorum === null) return null;
  let threshold: number;
  if (Array.isArray(vote.threshold)) {
    const [numerator, denominator] = vote.threshold;
    if (vote.threshold.length !== 2 || !Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator < 0 || denominator <= 0) return null;
    threshold = Math.min(Math.floor((numerator * members) / denominator) + 1, members);
  } else {
    const weight = positiveInteger(vote.threshold);
    if (weight === null) return null;
    threshold = Math.min(weight, members);
  }
  return Math.max(quorum, threshold);
}

/** The council's k-of-N approval rule, or null when the policy is not a usable council policy. */
export function councilRule(policy: DaoPolicy | null): CouncilRule | null {
  const council = policy?.roles?.find(role => role.name === "council");
  const members = council ? groupMembers(council.kind) : null;
  if (!members || members.length === 0) return null;
  const required = requiredApprovals(policy?.default_vote_policy, members.length);
  return required === null ? null : { members: members.length, required };
}

export function describeRule(rule: CouncilRule | null | undefined): string {
  return rule ? `${rule.required} of ${rule.members}` : "an unverified number of";
}

/**
 * Governance is enabled only for the pinned Sputnik build with a council-only, majority approval rule.
 * Any council size works; a minority of the council, or any other role, must not be able to decide a proposal.
 */
export function assessDaoPolicy(policy: DaoPolicy | null, codeHash: string | null): DaoAssessment {
  if (codeHash !== PINNED_SPUTNIK_CODE_HASH) return { verified: false, reason: "DAO code does not match the pinned Sputnik build." };
  if (!policy) return { verified: false, reason: "DAO policy is unavailable." };
  const council = policy.roles?.find(role => role.name === "council");
  const members = council ? groupMembers(council.kind) : null;
  if (!council || !members || members.length === 0 || members.length > MAX_COUNCIL || new Set(members).size !== members.length) {
    return { verified: false, reason: `DAO council must be a group of 1 to ${MAX_COUNCIL} distinct accounts.` };
  }
  if (!council.permissions?.some(permission => APPROVE_CALL.has(permission)) || Object.keys(council.vote_policy ?? {}).length !== 0) {
    return { verified: false, reason: "DAO council cannot approve function calls, or has per-proposal vote overrides." };
  }
  const outsider = policy.roles.find(role => role !== council && role.permissions?.some(permission => VOTES_ON_CALL.test(permission)));
  if (outsider) return { verified: false, reason: `DAO role "${outsider.name}" can vote on company proposals; only the council may.` };
  const rule = councilRule(policy);
  if (!rule) return { verified: false, reason: "DAO approval rule must be a role-weighted council threshold." };
  if (rule.required * 2 <= rule.members) {
    return { verified: false, reason: `DAO approval needs only ${rule.required} of ${rule.members} council votes; a majority is required.`, rule };
  }
  return { verified: true, reason: `Pinned Sputnik code and ${describeRule(rule)} council approval verified.`, rule };
}

export function councilMembers(policy: DaoPolicy | null): string[] {
  const council = policy?.roles?.find(role => role.name === "council");
  return (council && groupMembers(council.kind)) ?? [];
}
