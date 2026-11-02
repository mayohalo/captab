import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { buildGovernanceProposal, type ProposalAction, type ProposalRequest } from "../../../../../lib/proposal-builder";
import { type CompanyConfig, type Distribution, type Grant, type Totals, validAccountId, verifiedDaoPolicy, view } from "../../../../../lib/near";

export const runtime = "nodejs";

const actions: ProposalAction[] = ["founder", "pool", "grant", "cancelGrant", "approve", "fund", "pause", "resume", "cancelDistribution"];
const integerId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validAccountId(id)) return NextResponse.json({ error: "Invalid company account" }, { status: 400 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON request required" }, { status: 415 });
  const raw = await request.text();
  if (raw.length > 1_024) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let input: ProposalRequest;
  try { input = JSON.parse(raw) as ProposalRequest; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!input || typeof input !== "object" || !actions.includes(input.action) || !integerId(input.expectedRevision)) {
    return NextResponse.json({ error: "Invalid proposal action or revision" }, { status: 400 });
  }
  if (input.action === "cancelGrant" && !integerId(input.grantId) ||
      (input.action === "approve" || input.action === "fund" || input.action === "cancelDistribution") && !integerId(input.distributionId)) {
    return NextResponse.json({ error: "Invalid grant or distribution ID" }, { status: 400 });
  }
  let config: CompanyConfig;
  let totals: Totals;
  let policy: Awaited<ReturnType<typeof verifiedDaoPolicy>>;
  let grant: Grant | null;
  let distribution: Distribution | null;
  try {
    [config, totals] = await Promise.all([
      view<CompanyConfig>(id, "get_config"), view<Totals>(id, "get_totals"),
    ]);
    policy = await verifiedDaoPolicy(config.dao_id);
    [grant, distribution] = await Promise.all([
      input.action === "cancelGrant" ? view<Grant | null>(id, "get_grant", { grant_id: input.grantId }) : Promise.resolve(null),
      input.action === "approve" || input.action === "fund" || input.action === "cancelDistribution"
        ? view<Distribution | null>(id, "get_distribution", { distribution_id: input.distributionId }) : Promise.resolve(null),
    ]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Company or DAO read failed" }, { status: 502 });
  }
  try {
    const proposal = buildGovernanceProposal(input, { companyId: id, config, totals, grant, distribution,
      nowSeconds: Math.floor(Date.now() / 1000), actionId: randomUUID() });
    return NextResponse.json({ proposal, daoId: config.dao_id, proposalBond: policy.proposal_bond,
      expectedRevision: totals.ledger_revision, preparedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proposal could not be prepared";
    const conflict = /revision changed|exceed|closed|expired|already approved|before funding|paused|already active|cannot be cancelled|Select/.test(message);
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 400 });
  }
}
