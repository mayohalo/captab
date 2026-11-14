// Re-checks the v2 testnet deployment and its recorded rehearsal against live chain state. Read-only: no keys, no writes.
// Deployed code hashes and the DAO policy must equal docs/deployment-manifest.v2.testnet.json.
//   pnpm verify:evidence
// For every DAO proposal the rehearsal recorded, the DAO must report it Approved (executed). Every deal must be
// settled with its proceeds delivered, the explicit payout list fully paid, and the company totals, holdings,
// and DAO treasury must equal the recorded end state. Exits nonzero on any mismatch.
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidence = JSON.parse(await readFile(resolve(root, "docs/testnet-v2-rehearsal.json"), "utf8"));
const rpc = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com";
const explorer = "https://testnet.nearblocks.io";
let failures = 0;
const ok = (label, detail = "") => console.log(`  PASS  ${label}${detail ? `  ${detail}` : ""}`);
const fail = (label, detail = "") => { failures += 1; console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`); };
const check = (condition, label, detail) => condition ? ok(label, detail) : fail(label, detail);

async function rpcCall(method, params) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "captab", method, params }), signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => ({}));
    const limited = response.status === 429 || body?.error?.code === -429 || /rate limit/i.test(JSON.stringify(body?.error ?? ""));
    if (limited && attempt < 6) { await new Promise(done => setTimeout(done, 1_000 * 2 ** attempt)); continue; }
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 300)}`);
    return body.result;
  }
}

async function view(contract, method, args = {}) {
  const result = await rpcCall("query", { request_type: "call_function", finality: "final", account_id: contract,
    method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(result.result).toString("utf8"));
}

const { companyId, daoId, tokenId, finalState } = evidence;
console.log(`Captab evidence check against live NEAR testnet (${rpc})`);
console.log(`company ${companyId}\ndao     ${daoId}\ntoken   ${tokenId}\n`);

const status = await rpcCall("status", []);
check(status.chain_id === "testnet", "RPC is NEAR testnet", status.chain_id);

// 0. The deployed code and the board are exactly what the release manifest pins.
console.log("\nDeployed code and board (docs/deployment-manifest.v2.testnet.json)");
const manifest = JSON.parse(await readFile(resolve(root, "docs/deployment-manifest.v2.testnet.json"), "utf8"));
for (const [role, account, pinned] of [["company contract", manifest.companyId, manifest.company], ["Sputnik DAO", manifest.daoId, manifest.dao], ["TESTUSD token", manifest.tokenId, manifest.token]]) {
  const code = await rpcCall("query", { request_type: "view_code", finality: "final", account_id: account });
  check(code.hash === pinned.codeHash, `${role} code hash ${pinned.codeHash}`, `sha256 ${pinned.sha256.slice(0, 16)}…${role === "Sputnik DAO" ? `, source commit ${pinned.sourceCommit.slice(0, 7)}` : ""}`);
}
const policy = await view(manifest.daoId, "get_policy");
const council = policy.roles.find(role => role.name === "council")?.kind?.Group ?? [];
check(JSON.stringify([...council].sort()) === JSON.stringify([...manifest.dao.council].sort()), `board council is ${council.length} accounts`, council.join(", "));
// Canonical form: object keys sorted, string arrays (council members) sorted, so ordering differences do not matter.
const canonical = value => Array.isArray(value)
  ? (value.every(item => typeof item === "string") ? [...value].sort() : value.map(canonical))
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const [num, den] = policy.default_vote_policy.threshold;
check(JSON.stringify(canonical(policy)) === JSON.stringify(canonical(manifest.dao.policy)), "full DAO policy unchanged since deployment",
  `a proposal passes with more than ${num}/${den} of the council (${Math.floor(council.length * num / den) + 1} of ${council.length})`);
const config = await view(manifest.companyId, "get_config");
check(config.dao_id === manifest.daoId && config.settlement_token_id === manifest.tokenId, "company trusts only this DAO and settles in this token");

// 1. Every board action the rehearsal recorded was executed by the DAO.
console.log("\nBoard actions (Sputnik DAO proposals)");
const proposals = [];
for (const step of evidence.steps) {
  for (const [key, value] of Object.entries(step)) {
    if (value && typeof value === "object" && Number.isInteger(value.proposalId)) proposals.push({ step: step.step, key, ...value });
  }
}
for (const recorded of proposals.sort((a, b) => a.proposalId - b.proposalId)) {
  const live = await view(daoId, "get_proposal", { id: recorded.proposalId });
  const link = recorded.proposal?.hash ? `${explorer}/txns/${recorded.proposal.hash}` : "";
  check(live.status === "Approved", `#${String(recorded.proposalId).padStart(2)} ${recorded.step}/${recorded.key}: ${live.description.slice(0, 70)}`,
    `${live.status}${link ? `  ${link}` : ""}`);
}

// 2. The ledger matches the recorded end state.
console.log("\nOwnership ledger");
const company = await view(companyId, "get_company");
const totals = company.totals;
for (const field of ["authorized_units", "issued_total", "pool_available", "grant_reserved", "deal_reserved", "fully_diluted_total", "unallocated_units", "ledger_revision", "holder_count"]) {
  check(String(totals[field]) === String(finalState.totals[field]), `${field} = ${finalState.totals[field]}`, `live ${totals[field]}`);
}
check(company.config.schema_version === 2, "contract schema v2", `live v${company.config.schema_version}`);
const holdings = await view(companyId, "list_holdings", { from_index: 0, limit: 100 });
const issuedSum = holdings.reduce((sum, row) => sum + BigInt(row.issued_units), 0n);
check(issuedSum === BigInt(totals.issued_total), "holdings sum to issued units", `${issuedSum}`);
for (const recorded of finalState.holdings) {
  const live = holdings.find(row => row.account_id === recorded.account_id);
  check(live?.issued_units === recorded.issued_units, `${recorded.account_id} holds ${recorded.issued_units}`, `live ${live?.issued_units ?? "none"}`);
}

// 3. Deals settled, proceeds delivered.
console.log("\nRounds and deals");
const deals = await view(companyId, "list_deals", { from_index: 0, limit: 50 });
for (const recorded of finalState.deals) {
  const live = deals.find(deal => deal.id === recorded.id);
  check(live?.status === "Settled" && live.proceeds_pending === "0",
    `deal #${recorded.id} ${recorded.kind}: ${recorded.units} units for ${recorded.price} base units`, `${live?.status ?? "missing"}, pending ${live?.proceeds_pending ?? "?"}`);
}
const rounds = await view(companyId, "list_rounds", {});
const seed = rounds.find(round => round.id === "seed");
check(Boolean(seed) && seed.units_issued !== "0", "seed round recorded with units issued and amount raised", seed ? `${seed.units_issued} units, ${seed.amount_raised} base units` : "missing");

// 4. A holder signed from a third-party wallet extension (Meteor Wallet) on captab.xyz.
const walletGrant = evidence.steps.find(step => step.step === "wallet-extension-grant");
const walletUse = evidence.steps.find(step => step.step === "wallet-extension");
if (walletGrant && walletUse) {
  console.log("\nThird-party wallet");
  const grant = await view(companyId, "get_grant", { grant_id: walletGrant.grantId });
  check(grant.recipient === walletUse.recipient && grant.accepted_terms_hash === walletGrant.termsHash,
    `${walletUse.recipient} accepted grant #${walletGrant.grantId}'s terms from its own wallet`, `${explorer}/txns/${walletUse.accept.hash}`);
  check(grant.issued_units === walletUse.claimedUnits, `${walletUse.recipient} claimed ${walletUse.claimedUnits} vested units`, `${explorer}/txns/${walletUse.claim.hash}`);
}

// 5. Payouts.
console.log("\nPayouts");
const payout = evidence.steps.find(step => step.step === "explicit-payout");
const distributions = await view(companyId, "list_distributions", { from_index: 0, limit: 5 });
const explicit = distributions.find(row => row.id === payout.distributionId);
check(explicit?.kind === "Explicit" && explicit.budget === payout.budgetBaseUnits, `distribution #${payout.distributionId} is an explicit list of ${payout.budgetBaseUnits} base units`, explicit?.kind ?? "missing");
check(Boolean(explicit) && explicit.entitlements.every(row => row.payment_status === "Paid" || row.payment_status === "Zero") && explicit.paid_total === explicit.budget,
  "every recipient paid exactly once; paid total equals the budget", explicit ? `${explicit.paid_total}/${explicit.budget}` : "");
const treasury = await view(tokenId, "ft_balance_of", { account_id: daoId });
check(treasury === finalState.daoTreasuryBaseUnits, `DAO treasury holds ${finalState.daoTreasuryBaseUnits} TESTUSD base units`, `live ${treasury}`);

console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}: ${proposals.length} DAO proposals, ${finalState.deals.length} deals, ${finalState.holdings.length} holders.`);
process.exitCode = failures === 0 ? 0 : 1;
