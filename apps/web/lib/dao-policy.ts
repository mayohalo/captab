export const PINNED_SPUTNIK_CODE_HASH = "CB5QxzaBMy3kArDdQJPX3sEsXSeNdfLW4vx9qMn6uCgq";

export type DaoPolicy = {
  proposal_bond: string;
  default_vote_policy?: { weight_kind?: string; quorum?: string | number; threshold?: number[] };
  roles: { name: string; kind: { Group?: string[] }; permissions?: string[]; vote_policy?: Record<string, unknown> }[];
};

export type DaoAssessment = { verified: boolean; reason: string };

export function assessDemoDao(policy: DaoPolicy | null, codeHash: string | null): DaoAssessment {
  if (codeHash !== PINNED_SPUTNIK_CODE_HASH) return { verified: false, reason: "DAO code does not match the pinned Sputnik build." };
  if (!policy) return { verified: false, reason: "DAO policy is unavailable." };
  const council = policy.roles?.find(role => role.name === "council");
  const members = council?.kind?.Group;
  if (!council || !Array.isArray(members) || members.length !== 3 || new Set(members).size !== 3) {
    return { verified: false, reason: "DAO council must contain three distinct accounts." };
  }
  if (!council.permissions?.includes("*:VoteApprove") || Object.keys(council.vote_policy ?? {}).length !== 0) {
    return { verified: false, reason: "DAO council permissions or vote overrides differ from the demo policy." };
  }
  const vote = policy.default_vote_policy;
  const ratio = vote?.threshold;
  if (vote?.weight_kind !== "RoleWeight" || String(vote.quorum) !== "0" || !Array.isArray(ratio) || ratio.length !== 2 || ratio[0] !== 1 || ratio[1] !== 2) {
    return { verified: false, reason: "DAO approval threshold is not the required two of three." };
  }
  return { verified: true, reason: "Pinned Sputnik code and two-of-three council policy verified." };
}
