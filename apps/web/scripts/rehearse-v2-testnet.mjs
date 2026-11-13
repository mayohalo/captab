// Live schema v2 rehearsal on NEAR testnet. Run with CAPTAB_DEPLOYMENT=v2 after `pnpm deploy:testnet --apply`.
// Every board action is a real Sputnik proposal approved by two of three council members. Steps check chain
// state first, so a re-run skips completed work. Public receipts go to docs/testnet-v2-rehearsal.json.
// Signs with the test-only local key bundle; never point it at accounts holding real value.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, teraToGas } from "near-api-js";
import { accountsPath, deploymentProfile, manifestPath, root } from "./deployment-paths.mjs";

if (deploymentProfile !== "v2") throw new Error("Run with CAPTAB_DEPLOYMENT=v2");
const credentials = JSON.parse(await readFile(accountsPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const evidencePath = resolve(root, "docs/testnet-v2-rehearsal.json");
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
if (await provider.getNetworkId() !== "testnet") throw new Error("RPC endpoint is not NEAR testnet");
if (manifest.companyId !== credentials.accounts.company.accountId || manifest.company?.schemaVersion !== 2) {
  throw new Error("The v2 manifest does not match the v2 key bundle");
}
const { companyId, daoId, tokenId } = manifest;
const accounts = Object.fromEntries(Object.entries(credentials.accounts).map(([role, value]) => [role, new Account(value.accountId, provider, value.privateKey)]));
const id = role => credentials.accounts[role].accountId;
const council = [accounts.council1, accounts.council2];
const TESTUSD = 1_000_000n;
const doc = text => createHash("sha256").update(text).digest("hex");
const DOCS = {
  charter: doc("Captab v2 testnet demo: charter amendment raising authorized units to 12,000,000"),
  founders: doc("Captab v2 testnet demo: founder stock issuance"),
  grant: doc("Captab v2 testnet demo: contributor grant agreement, 100,000 units, 48 months, 12-month cliff"),
  founderGrant: doc("Captab v2 testnet demo: founder vesting agreement for founder B"),
  seed: doc("Captab v2 testnet demo: seed round terms at 0.01 TESTUSD per unit"),
  sale: doc("Captab v2 testnet demo: share purchase agreement, founder B to angel"),
  buyback: doc("Captab v2 testnet demo: repurchase agreement with the contributor"),
  exit: doc("Captab v2 testnet demo: board-approved payout list"),
};

let evidence;
try { evidence = JSON.parse(await readFile(evidencePath, "utf8")); } catch { evidence = null; }
if (!evidence || evidence.companyId !== companyId) {
  evidence = { network: "testnet", schemaVersion: 2, companyId, daoId, tokenId,
    signer: "Local Node process with the test-only v2 key bundle; keys stay in ignored files", documents: DOCS, steps: [] };
}
const tx = hash => ({ hash, explorerUrl: `https://testnet.nearblocks.io/txns/${hash}` });
async function record(step, data) {
  evidence.steps = evidence.steps.filter(entry => entry.step !== step);
  evidence.steps.push({ step, ...data });
  evidence.updatedAt = new Date().toISOString();
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ step, ...data }));
}
const done = step => evidence.steps.some(entry => entry.step === step);

const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } });
const balance = async role => BigInt(await view(tokenId, "ft_balance_of", { account_id: role === "dao" ? daoId : id(role) }));
const totals = () => view(companyId, "get_totals");

function succeeded(result, label) {
  const status = result?.status;
  if (!status || typeof status !== "object" || !("SuccessValue" in status || "SuccessReceiptId" in status)) {
    throw new Error(`${label} failed; inspect ${result?.transaction?.hash ?? "unknown transaction"}: ${JSON.stringify(status)}`);
  }
  const failedReceipt = result.receipts_outcome?.find(receipt => receipt.outcome?.status && "Failure" in receipt.outcome.status);
  return { hash: result.transaction.hash, failedReceipt: failedReceipt ? JSON.stringify(failedReceipt.outcome.status.Failure).slice(0, 300) : null };
}

async function call(role, contractId, methodName, args, { gas = 100, deposit = 0n, allowFailedReceipt = false } = {}) {
  const result = await accounts[role].callFunctionRaw({ contractId, methodName, args, gas: teraToGas(gas), deposit, waitUntil: "FINAL" });
  const { hash, failedReceipt } = succeeded(result, `${role} ${methodName}`);
  if (failedReceipt && !allowFailedReceipt) throw new Error(`${role} ${methodName} had a failed receipt in ${hash}: ${failedReceipt}`);
  return hash;
}

/** A Sputnik FunctionCall proposal from council1, approved by council1 and council2. */
async function proposal(description, receiverId, calls) {
  const kind = { FunctionCall: { receiver_id: receiverId, actions: calls.map(({ method, args, gas = 100, deposit = "0" }) => ({
    method_name: method, args: Buffer.from(JSON.stringify(args)).toString("base64"), gas: String(BigInt(gas) * 10n ** 12n), deposit })) } };
  const policy = await view(daoId, "get_policy");
  const added = await council[0].callFunctionRaw({ contractId: daoId, methodName: "add_proposal", args: { proposal: { description, kind } },
    gas: teraToGas(100), deposit: BigInt(policy.proposal_bond), waitUntil: "FINAL" });
  const { hash: addHash } = succeeded(added, "add_proposal");
  const proposalId = JSON.parse(Buffer.from(added.status.SuccessValue, "base64").toString("utf8"));
  const votes = [];
  for (const member of council) {
    const vote = await member.callFunctionRaw({ contractId: daoId, methodName: "act_proposal",
      args: { id: proposalId, action: "VoteApprove", proposal: kind }, gas: teraToGas(300), deposit: 0n, waitUntil: "FINAL" });
    votes.push(succeeded(vote, "act_proposal").hash);
  }
  const state = await view(daoId, "get_proposal", { id: proposalId });
  if (state.status !== "Approved") throw new Error(`Proposal ${proposalId} ended ${state.status}; inspect ${votes.at(-1)}`);
  return { proposalId, proposal: tx(addHash), votes: votes.map(tx) };
}

const company = (method, args, gas = 100) => ({ method, args, gas });
function boundaries(startIso, months) {
  const start = new Date(startIso);
  return Array.from({ length: months + 1 }, (_, offset) => {
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset + 1, 0)).getUTCDate();
    return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, Math.min(start.getUTCDate(), lastDay)) / 1000;
  });
}
const expiry = days => Math.floor(Date.now() / 1000) + days * 86_400;
const expect = (condition, message) => { if (!condition) throw new Error(message); };

// 1. Token registrations (founder B stays unregistered so their sale proceeds are held first) and investor funds.
if (!done("token-setup")) {
  const registrations = [];
  for (const role of ["investor", "angel", "foundera", "contributor"]) {
    if (await view(tokenId, "storage_balance_of", { account_id: id(role) })) continue;
    registrations.push(tx(await call("operator", tokenId, "storage_deposit", { account_id: id(role), registration_only: true },
      { gas: 30, deposit: 12_500_000_000_000_000_000_000n })));
  }
  const funding = await proposal("Fund the v2 rehearsal investor and angel with TESTUSD", tokenId, [
    { method: "ft_transfer", args: { receiver_id: id("investor"), amount: String(20_000n * TESTUSD) }, gas: 15, deposit: "1" },
    { method: "ft_transfer", args: { receiver_id: id("angel"), amount: String(15_000n * TESTUSD) }, gas: 15, deposit: "1" },
  ]);
  expect(await balance("investor") === 20_000n * TESTUSD && await balance("angel") === 15_000n * TESTUSD, "Investor funding did not settle");
  await record("token-setup", { registrations, funding });
}

// 2. Phase B through the board: charter amendment, founders with a document hash, pool.
if (!done("charter-and-founders")) {
  let t = await totals();
  const amend = await proposal("Raise authorized units to 12,000,000", companyId, [company("increase_authorized",
    { action_id: "v2-live-charter", expected_revision: t.ledger_revision, authorized_units: "12000000", doc_hash: DOCS.charter })]);
  t = await totals();
  const founderA = await proposal("Issue 3,600,000 units to founder A", companyId, [company("issue_founder_units",
    { action_id: "v2-live-founder-a", expected_revision: t.ledger_revision, recipient: id("foundera"), units: "3600000", doc_hash: DOCS.founders })]);
  t = await totals();
  const founderB = await proposal("Issue 2,400,000 units to founder B", companyId, [company("issue_founder_units",
    { action_id: "v2-live-founder-b", expected_revision: t.ledger_revision, recipient: id("founderb"), units: "2400000", doc_hash: DOCS.founders })]);
  t = await totals();
  const pool = await proposal("Reserve a 2,000,000-unit contributor pool", companyId, [company("increase_pool",
    { action_id: "v2-live-pool", expected_revision: t.ledger_revision, units: "2000000" })]);
  t = await totals();
  expect(t.authorized_units === "12000000" && t.issued_total === "6000000" && t.pool_available === "2000000", "Charter and founders do not reconcile");
  await record("charter-and-founders", { amend, founderA, founderB, pool, totals: t });
}

// 3. Contributor grant with a document; the contributor accepts the terms and claims at the cliff.
if (!done("contributor-grant")) {
  const t = await totals();
  const grant = await proposal("Grant 100,000 units to the contributor (48 months, 12-month cliff)", companyId, [company("create_grant", {
    action_id: "v2-live-contributor-grant", expected_revision: t.ledger_revision, recipient: id("contributor"), units: "100000",
    boundaries: boundaries("2025-11-01T00:00:00Z", 48), doc_hash: DOCS.grant, terms: { cliff_index: 12, source: "Pool" } })]);
  const grants = await view(companyId, "list_grants", { from_index: 0, limit: 20 });
  const grantId = grants.find(g => g.recipient === id("contributor")).id;
  const accept = await call("contributor", companyId, "accept_grant", { grant_id: grantId, terms_hash: DOCS.grant }, { gas: 30 });
  const claim = await call("contributor", companyId, "claim_vested", { grant_id: grantId }, { gas: 30 });
  const view_ = await view(companyId, "get_grant", { grant_id: grantId });
  expect(view_.issued_units === "25000" && view_.accepted_terms_hash === DOCS.grant, "Contributor grant did not reconcile");
  await record("contributor-grant", { grant, grantId, accept: tx(accept), claim: tx(claim), claimedUnits: "25000" });
}

/** DAO proposals whose descriptions match, for recording a step that finished before an interruption. */
async function proposalsDescribed(descriptions) {
  const last = await view(daoId, "get_last_proposal_id");
  const all = await view(daoId, "get_proposals", { from_index: 0, limit: last });
  return descriptions.map(text => {
    const match = all.find(item => item.description === text);
    if (!match || match.status !== "Approved") throw new Error(`No approved proposal "${text}"`);
    return { proposalId: match.id, status: match.status };
  });
}

// 4. Founder vesting from unallocated capacity, accelerated by the board, then claimed; and a pool reduction.
const founderGrantDone = (await view(companyId, "list_grants", { from_index: 0, limit: 20 }))
  .find(g => g.recipient === id("founderb") && g.accelerated_months === 12 && g.issued_units === "120000");
if (!done("founder-vesting") && founderGrantDone && (await totals()).pool_available === "1800000") {
  const [grant, accelerate, shrink] = await proposalsDescribed(["Founder B vesting grant: 480,000 units from unallocated capacity",
    "Accelerate founder B's grant by 12 months", "Return 100,000 pool units to unallocated capacity"]);
  await record("founder-vesting", { grant, grantId: founderGrantDone.id, accelerate, shrink, claimedUnits: "120000",
    recoveredFromChain: "Completed on chain before the rehearsal process was interrupted; evidence rebuilt from DAO proposals and grant state. Transaction hashes are on the DAO and company account pages.",
    totals: await totals() });
}
if (!done("founder-vesting")) {
  let t = await totals();
  const grant = await proposal("Founder B vesting grant: 480,000 units from unallocated capacity", companyId, [company("create_grant", {
    action_id: "v2-live-founder-b-grant", expected_revision: t.ledger_revision, recipient: id("founderb"), units: "480000",
    boundaries: boundaries("2026-11-01T00:00:00Z", 48), doc_hash: DOCS.founderGrant, terms: { cliff_index: 12, source: "Unallocated" } })]);
  const grants = await view(companyId, "list_grants", { from_index: 0, limit: 20 });
  const grantId = grants.find(g => g.recipient === id("founderb")).id;
  expect((await view(companyId, "get_grant", { grant_id: grantId })).vested_units === "0", "Founder grant vested before acceleration");
  const accelerate = await proposal("Accelerate founder B's grant by 12 months", companyId, [company("accelerate_grant",
    { action_id: "v2-live-accelerate", grant_id: grantId, months: 12, doc_hash: DOCS.founderGrant })]);
  const claim = await call("founderb", companyId, "claim_vested", { grant_id: grantId }, { gas: 30 });
  t = await totals();
  const shrink = await proposal("Return 100,000 pool units to unallocated capacity", companyId, [company("decrease_pool",
    { action_id: "v2-live-shrink-pool", expected_revision: t.ledger_revision, units: "100000" })]);
  t = await totals();
  expect(t.pool_available === "1800000" && t.issued_total === "6145000" && t.grant_reserved === "435000", "Founder vesting does not reconcile");
  await record("founder-vesting", { grant, grantId, accelerate, claim: tx(claim), claimedUnits: "120000", shrink, totals: t });
}

// 5. Seed round: wrong amount and wrong payer are refunded; the investor's exact payment issues units and reaches the DAO.
if (!done("seed-round")) {
  const round = await proposal("Open the seed round at 0.01 TESTUSD per unit", companyId, [company("create_round",
    { action_id: "v2-live-seed", round_id: "seed", price_per_unit: String(10_000n), doc_hash: DOCS.seed })]);
  const price = 1_000_000n * 10_000n;
  const allocation = await proposal("Approve the investor's 1,000,000-unit seed allocation", companyId, [company("approve_deal",
    { action_id: "v2-live-seed-alloc", terms: { kind: "Issue", buyer: id("investor"), units: "1000000", price: String(price),
      expires_at: expiry(14), round_id: "seed", doc_hash: DOCS.seed } })]);
  const deals = await view(companyId, "list_deals", { from_index: 0, limit: 50 });
  const dealId = deals.find(d => d.kind === "Issue" && d.buyer === id("investor")).id;
  const pay = (role, amount) => call(role, tokenId, "ft_transfer_call",
    { receiver_id: companyId, amount: String(amount), msg: JSON.stringify({ deal_id: dealId }) }, { gas: 150, deposit: 1n });
  const investorBefore = await balance("investor");
  const wrongAmount = await pay("investor", price - 1n);
  expect(await balance("investor") === investorBefore, "A wrong amount was not refunded");
  const angelBefore = await balance("angel");
  const wrongPayer = await pay("angel", price);
  expect(await balance("angel") === angelBefore, "A wrong payer was not refunded");
  const daoBefore = await balance("dao");
  const paid = await pay("investor", price);
  const deal = await view(companyId, "get_deal", { deal_id: dealId });
  expect(deal.status === "Settled" && deal.proceeds_pending === "0", `Seed deal did not settle: ${JSON.stringify(deal)}`);
  expect(await balance("dao") === daoBefore + price, "Seed proceeds did not reach the DAO");
  expect(String(await view(companyId, "get_holding", { account_id: id("investor") })) === "1000000", "Investor units were not issued");
  await record("seed-round", { round, allocation, dealId, refusedWrongAmount: tx(wrongAmount), refusedWrongPayer: tx(wrongPayer),
    payment: tx(paid), daoReceivedBaseUnits: String(price), roundState: await view(companyId, "get_round", { round_id: "seed" }) });
}

// 6. Secondary sale: board approval, seller signature, buyer payment, held proceeds, then a public retry.
if (!done("secondary-sale")) {
  const price = 1_500n * TESTUSD;
  const approval = await proposal("Approve founder B's sale of 100,000 units to the angel", companyId, [company("approve_deal",
    { action_id: "v2-live-sale", terms: { kind: "Secondary", seller: id("founderb"), buyer: id("angel"), units: "100000",
      price: String(price), expires_at: expiry(14), doc_hash: DOCS.sale } })]);
  const deals = await view(companyId, "list_deals", { from_index: 0, limit: 50 });
  const dealId = deals.find(d => d.kind === "Secondary").id;
  const accept = await call("founderb", companyId, "accept_deal", { deal_id: dealId }, { gas: 30 });
  const paid = await call("angel", tokenId, "ft_transfer_call",
    // The detached forward to the unregistered seller fails by design; that failed receipt is expected here.
    { receiver_id: companyId, amount: String(price), msg: JSON.stringify({ deal_id: dealId }) }, { gas: 150, deposit: 1n, allowFailedReceipt: true });
  const held = await view(companyId, "get_deal", { deal_id: dealId });
  expect(held.status === "Settled" && held.proceeds_pending === String(price) && !held.forward_in_flight,
    `Proceeds were not held for the unregistered seller: ${JSON.stringify(held)}`);
  const register = await call("operator", tokenId, "storage_deposit", { account_id: id("founderb"), registration_only: true },
    { gas: 30, deposit: 12_500_000_000_000_000_000_000n });
  const retry = await call("operator", companyId, "forward_proceeds", { deal_id: dealId }, { gas: 60 });
  expect(await balance("founderb") === price, "Seller was not paid after the retry");
  expect(String(await view(companyId, "get_holding", { account_id: id("angel") })) === "100000", "Angel units did not move");
  await record("secondary-sale", { approval, dealId, accept: tx(accept), payment: tx(paid), heldBaseUnits: String(price),
    registerSeller: tx(register), retry: tx(retry), sellerPaidBaseUnits: String(price) });
}

// 7. Buyback: the contributor signs, the DAO pays through a proposal, and the units are retired.
if (!done("buyback")) {
  const price = 60n * TESTUSD;
  const approval = await proposal("Approve buying back 5,000 units from the contributor", companyId, [company("approve_deal",
    { action_id: "v2-live-buyback", terms: { kind: "Buyback", seller: id("contributor"), units: "5000", price: String(price),
      expires_at: expiry(14), doc_hash: DOCS.buyback } })]);
  const deals = await view(companyId, "list_deals", { from_index: 0, limit: 50 });
  const dealId = deals.find(d => d.kind === "Buyback").id;
  const accept = await call("contributor", companyId, "accept_deal", { deal_id: dealId }, { gas: 30 });
  const issuedBefore = BigInt((await totals()).issued_total);
  const contributorBefore = await balance("contributor");
  const payment = await proposal("Pay 60 TESTUSD for the contributor buyback", tokenId, [{ method: "ft_transfer_call",
    args: { receiver_id: companyId, amount: String(price), msg: JSON.stringify({ deal_id: dealId }) }, gas: 150, deposit: "1" }]);
  expect(BigInt((await totals()).issued_total) === issuedBefore - 5_000n, "Buyback units were not retired");
  expect(await balance("contributor") === contributorBefore + price, "Contributor was not paid for the buyback");
  await record("buyback", { approval, dealId, accept: tx(accept), payment, retiredUnits: "5000" });
}

// 8. Explicit payout list set by the board, funded exactly by the DAO, and paid recipient by recipient.
if (!done("explicit-payout")) {
  const payouts = [["investor", 1_000n], ["foundera", 500n], ["founderb", 350n], ["angel", 100n], ["contributor", 50n]]
    .map(([role, amount]) => ({ account_id: id(role), amount: String(amount * TESTUSD) }));
  const budget = payouts.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  const t = await totals();
  const prepared = await proposal("Board-set payout list (preference demo)", companyId, [company("prepare_explicit_distribution", {
    action_id: "v2-live-explicit", expected_revision: t.ledger_revision, budget: String(budget), expires_at: expiry(14),
    payouts, label: "preference demo", doc_hash: DOCS.exit }, 200)]);
  const list = await view(companyId, "list_distributions", { from_index: 0, limit: 5 });
  const distribution = list.find(d => d.kind === "Explicit");
  const funding = await proposal("Fund the payout list exactly", tokenId, [{ method: "ft_transfer_call",
    args: { receiver_id: companyId, amount: String(budget), msg: JSON.stringify({ distribution_id: distribution.id, schedule_hash: distribution.schedule_hash }) },
    gas: 150, deposit: "1" }]);
  const before = Object.fromEntries(await Promise.all(payouts.map(async row =>
    [row.account_id, BigInt(await view(tokenId, "ft_balance_of", { account_id: row.account_id }))])));
  const payments = [];
  for (const row of payouts) {
    payments.push({ recipient: row.account_id, ...tx(await call("executor", companyId, "pay_recipient",
      { distribution_id: distribution.id, recipient_id: row.account_id }, { gas: 100 })) });
  }
  for (const row of payouts) {
    const after = BigInt(await view(tokenId, "ft_balance_of", { account_id: row.account_id }));
    expect(after === before[row.account_id] + BigInt(row.amount), `${row.account_id} payout did not settle`);
  }
  const settled = await view(companyId, "get_distribution", { distribution_id: distribution.id });
  expect(settled.paid_total === String(budget) && settled.available_escrow === "0" && settled.in_flight_total === "0", "Payout list does not reconcile");
  await record("explicit-payout", { prepared, distributionId: distribution.id, scheduleHash: Buffer.from(distribution.schedule_hash).toString("hex"),
    funding, payments, budgetBaseUnits: String(budget) });
}

// Final state, read at finality.
const final = await totals();
const holdings = await view(companyId, "list_holdings", { from_index: 0, limit: 100 });
const issued = holdings.reduce((sum, h) => sum + BigInt(h.issued_units), 0n);
expect(issued === BigInt(final.issued_total), "Holdings do not sum to issued units");
expect(BigInt(final.issued_total) + BigInt(final.pool_available) + BigInt(final.grant_reserved) === BigInt(final.fully_diluted_total) &&
  BigInt(final.authorized_units) - BigInt(final.fully_diluted_total) - BigInt(final.deal_reserved) === BigInt(final.unallocated_units),
  "Final supply does not reconcile");
evidence.finalState = { totals: final, holdings, daoTreasuryBaseUnits: String(await balance("dao")),
  deals: await view(companyId, "list_deals", { from_index: 0, limit: 50 }), checkedAt: new Date().toISOString() };
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ status: "v2 rehearsal complete", totals: final, evidence: evidencePath }));
