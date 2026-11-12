import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { buildGovernanceProposal, type ProposalAction, type ProposalRequest, V1_ACTIONS, V2_ACTIONS } from "../../../../../lib/proposal-builder";
import { type CompanyConfig, type Deal, type Distribution, type Grant, type Round, type Totals, validAccountId, verifiedCompanyCode, verifiedDaoPolicy, view } from "../../../../../lib/near";

export const runtime = "nodejs";

const actions: readonly ProposalAction[] = [...V1_ACTIONS, ...V2_ACTIONS];
const needsGrant = (action: ProposalAction) => action === "cancelGrant" || action === "accelerateGrant";
const needsDistribution = (action: ProposalAction) => action === "approve" || action === "fund" || action === "cancelDistribution";
const needsDeal = (action: ProposalAction) => action === "cancelDeal" || action === "payBuyback";
const integerId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validAccountId(id)) return NextResponse.json({ error: "Invalid company account" }, { status: 400 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON request required" }, { status: 415 });
  const raw = await request.text();
  // An explicit payout list carries up to 100 rows; everything else is far smaller.
  if (raw.length > 16_384) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let input: ProposalRequest;
  try { input = JSON.parse(raw) as ProposalRequest; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!input || typeof input !== "object" || !actions.includes(input.action) || !integerId(input.expectedRevision)) {
    return NextResponse.json({ error: "Invalid proposal action or revision" }, { status: 400 });
  }
  if (needsGrant(input.action) && !integerId(input.grantId) || needsDistribution(input.action) && !integerId(input.distributionId) ||
      needsDeal(input.action) && !integerId(input.dealId)) {
    return NextResponse.json({ error: "Invalid grant, distribution, or deal ID" }, { status: 400 });
  }
  const roundId = typeof input.roundId === "string" && /^[a-z0-9-]{1,32}$/.test(input.roundId) ? input.roundId : null;
  if ((input.action === "closeRound" || input.action === "approveDeal" && input.dealKind === "Issue") && !roundId) {
    return NextResponse.json({ error: "Invalid round ID" }, { status: 400 });
  }
  let config: CompanyConfig;
  let totals: Totals;
  let policy: Awaited<ReturnType<typeof verifiedDaoPolicy>>;
  let grant: Grant | null;
  let distribution: Distribution | null;
  let deal: Deal | null;
  let round: Round | null;
  try {
    await verifiedCompanyCode(id);
    [config, totals] = await Promise.all([
      view<CompanyConfig>(id, "get_config"), view<Totals>(id, "get_totals"),
    ]);
    policy = await verifiedDaoPolicy(config.dao_id);
    const v2 = config.schema_version === 2;
    [grant, distribution, deal, round] = await Promise.all([
      needsGrant(input.action) ? view<Grant | null>(id, "get_grant", { grant_id: input.grantId }) : Promise.resolve(null),
      needsDistribution(input.action) ? view<Distribution | null>(id, "get_distribution", { distribution_id: input.distributionId }) : Promise.resolve(null),
      v2 && needsDeal(input.action) ? view<Deal | null>(id, "get_deal", { deal_id: input.dealId }) : Promise.resolve(null),
      v2 && roundId ? view<Round | null>(id, "get_round", { round_id: roundId }) : Promise.resolve(null),
    ]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Company or DAO read failed" }, { status: 502 });
  }
  try {
    const proposal = buildGovernanceProposal(input, { companyId: id, config, totals, grant, distribution, deal, round,
      nowSeconds: Math.floor(Date.now() / 1000), actionId: randomUUID() });
    return NextResponse.json({ proposal, daoId: config.dao_id, proposalBond: policy.proposal_bond,
      expectedRevision: totals.ledger_revision, preparedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proposal could not be prepared";
    const conflict = /revision changed|exceed|closed|expired|already approved|before funding|paused|already active|cannot be cancelled|Select|only increase|Only an accepted/.test(message);
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 400 });
  }
}
